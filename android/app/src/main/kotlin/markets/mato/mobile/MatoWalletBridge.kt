package markets.mato.mobile

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.Solana
import com.solana.mobilewalletadapter.clientlib.TransactionParams
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import com.solana.mobilewalletadapter.clientlib.protocol.JsonRpc20Client
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient.AuthorizationResult
import com.solana.mobilewalletadapter.common.ProtocolContract
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.math.BigInteger
import java.security.KeyStore
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Instantiate before the Activity is STARTED; ActivityResultSender registers a launcher. */
class MatoWalletBridge(
    private val activity: ComponentActivity,
    messenger: BinaryMessenger,
) : MethodChannel.MethodCallHandler {
    private val channel = MethodChannel(messenger, "app.mato/wallet")
    private val sender = ActivityResultSender(activity)
    private val store = WalletAuthorizationStore(activity)
    private val stateLock = Any()
    private val busy = AtomicBoolean(false)
    private val generation = AtomicLong(0)
    private val adapter = MobileWalletAdapter(
        connectionIdentity = ConnectionIdentity(
            identityUri = Uri.parse("https://mato.markets"),
            iconUri = Uri.parse("icon-192.png"),
            identityName = "Mato",
        ),
    ).apply { blockchain = Solana.Mainnet }

    @Volatile private var session: WalletSession? = null
    @Volatile private var closed = false

    init { channel.setMethodCallHandler(this) }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        if (closed) {
            result.error("unavailable", "Wallet bridge is unavailable.", null)
            return
        }
        when (call.method) {
            "restore" -> perform(result) { request ->
                synchronized(stateLock) {
                    assertActive(request)
                    session = store.read()
                    adapter.authToken = session?.authToken
                    sessionMap()
                }
            }
            "connect" -> perform(result) { request ->
                val connected = unwrap(adapter.connect(sender))
                val authorized = checkedSession(connected.authResult)
                save(authorized, request)
                sessionMap()
            }
            "disconnect" -> disconnect(result)
            "signAndSend" -> perform(result) { request ->
                val transaction = call.argument<ByteArray>("transaction")
                    ?: throw WalletFailure("invalid_transaction")
                val expected = call.argument<String>("expectedAddress")
                    ?: throw WalletFailure("account_changed")
                val reviewed = session ?: throw WalletFailure("authorization_expired")
                if (reviewed.address != expected) throw WalletFailure("account_changed")
                validateTransaction(transaction, reviewed.publicKey)
                adapter.authToken = reviewed.authToken
                val sent = unwrap(adapter.transact(sender) { authorization ->
                    assertActive(request)
                    // A cached token is never sufficient to approve a transaction.
                    // Confirm that fresh authorization still includes its reviewed signer.
                    val authorized = checkedSession(authorization, reviewed)
                    save(authorized, request)
                    assertActive(request)
                    signAndSendTransactions(
                        arrayOf(transaction),
                        TransactionParams(
                            minContextSlot = null,
                            commitment = "confirmed",
                            skipPreflight = false,
                            maxRetries = null,
                            waitForCommitmentToSendNextTransaction = true,
                        ),
                    )
                })
                val signatures = sent.payload.signatures
                if (signatures.size != 1 || signatures[0].size != 64 || signatures[0].all { it == 0.toByte() }) {
                    throw WalletFailure("invalid_signature")
                }
                // Return an actual receipt even if disconnected after submission started.
                base58(signatures[0])
            }
            else -> result.notImplemented()
        }
    }

    private fun perform(result: MethodChannel.Result, action: suspend (Long) -> Any?) {
        if (!busy.compareAndSet(false, true)) {
            result.error("busy", "Finish the current wallet request first.", null)
            return
        }
        val request = generation.get()
        activity.lifecycleScope.launch {
            try {
                result.success(action(request))
            } catch (failure: Exception) {
                val code = errorCode(failure)
                if (code == "authorization_expired" || code == "account_changed") {
                    try { clearSession() } catch (_: Exception) { /* Original failure is retained. */ }
                }
                // Never return SDK exception messages, which can contain auth or payload data.
                result.error(code, "Wallet request failed.", null)
            } finally {
                if (request != generation.get()) adapter.authToken = null
                busy.set(false)
            }
        }
    }

    private fun disconnect(result: MethodChannel.Result) {
        val token = session?.authToken
        try {
            // Invalidate before any await, including while another screen owns a request.
            clearSession()
        } catch (_: Exception) {
            result.error("storage", "Could not remove saved wallet authorization.", null)
            return
        }
        if (token == null || !busy.compareAndSet(false, true)) {
            result.success(null)
            return
        }
        activity.lifecycleScope.launch {
            try {
                adapter.authToken = token
                // Local credentials have already been deleted. Wallet-side revocation is
                // best effort when the wallet is unavailable or the user dismisses it.
                adapter.disconnect(sender)
            } catch (_: Exception) {
                // The user can also revoke Mato in their wallet's connected-app settings.
            } finally {
                adapter.authToken = null
                busy.set(false)
                result.success(null)
            }
        }
    }

    private fun clearSession() = synchronized(stateLock) {
        generation.incrementAndGet()
        session = null
        adapter.authToken = null
        store.clear()
    }

    private fun save(value: WalletSession, request: Long) = synchronized(stateLock) {
        assertActive(request)
        store.write(value)
        session = value
    }

    private fun assertActive(request: Long) {
        if (closed || request != generation.get()) throw WalletFailure("account_changed")
    }

    private fun sessionMap(): Map<String, Any?> = mapOf("address" to session?.address)

    private fun checkedSession(auth: AuthorizationResult, reviewed: WalletSession? = null): WalletSession {
        val walletUri = safeWalletUri(auth.walletUriBase?.toString())
        if (reviewed?.walletUri != null && walletUri != reviewed.walletUri) {
            throw WalletFailure("account_changed")
        }
        val account = if (reviewed == null) auth.accounts.firstOrNull() else
            auth.accounts.firstOrNull { it.publicKey.contentEquals(reviewed.publicKey) }
        if (account == null) throw WalletFailure(if (reviewed == null) "invalid_response" else "account_changed")
        if (account.publicKey.size != 32 || auth.authToken.isBlank()) throw WalletFailure("invalid_response")
        return WalletSession(account.publicKey.clone(), auth.authToken, walletUri)
    }

    private fun <T> unwrap(value: TransactionResult<T>): TransactionResult.Success<T> = when (value) {
        is TransactionResult.Success -> value
        is TransactionResult.NoWalletFound -> throw WalletFailure("no_wallet")
        is TransactionResult.Failure -> throw WalletFailure(errorCode(value.e))
    }

    fun close() {
        closed = true
        generation.incrementAndGet()
        channel.setMethodCallHandler(null)
    }
}

private class WalletFailure(val code: String) : IllegalStateException(code)

private fun errorCode(failure: Throwable): String {
    var current: Throwable? = failure
    repeat(8) {
        when (val cause = current) {
            is WalletFailure -> return cause.code
            is JsonRpc20Client.JsonRpc20RemoteException -> return when (cause.code) {
                ProtocolContract.ERROR_AUTHORIZATION_FAILED -> "authorization_expired"
                ProtocolContract.ERROR_NOT_SIGNED -> "cancelled"
                else -> "wallet_failure"
            }
            is CancellationException, is InterruptedException -> return "cancelled"
            is java.util.concurrent.TimeoutException -> return "timeout"
            is android.content.ActivityNotFoundException -> return "no_wallet"
        }
        current = current?.cause
    }
    return "wallet_failure"
}

private data class WalletSession(val publicKey: ByteArray, val authToken: String, val walletUri: String?) {
    val address: String get() = base58(publicKey)
}

/** No token crosses the Dart channel; encrypted authorization is excluded from all backups. */
private class WalletAuthorizationStore(context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "mato-wallet-v1"))
    private val keyAlias = "app.mato.wallet.v1"
    private val associatedData = "app.mato/wallet:1:solana:mainnet".toByteArray(Charsets.UTF_8)

    fun read(): WalletSession? {
        if (!file.baseFile.exists()) return null
        return try {
            val encrypted = file.readFully()
            require(encrypted.size > 28 && encrypted.size <= 65536)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, encrypted.copyOfRange(0, 12)))
            cipher.updateAAD(associatedData)
            val json = JSONObject(String(cipher.doFinal(encrypted.copyOfRange(12, encrypted.size)), Charsets.UTF_8))
            require(json.getInt("version") == 1 && json.getString("chain") == "solana:mainnet")
            val publicKey = Base64.decode(json.getString("publicKey"), Base64.NO_WRAP)
            val token = json.getString("authToken")
            require(publicKey.size == 32 && token.isNotBlank())
            WalletSession(publicKey, token, safeWalletUri(json.optString("walletUri").takeIf { it.isNotEmpty() }))
        } catch (_: Exception) {
            // A reinstalled app cannot decrypt old credentials; corrupt records must not
            // produce a connected account or be silently used in an authorization request.
            clear()
            null
        }
    }

    fun write(session: WalletSession) {
        try {
            val json = JSONObject().put("version", 1).put("chain", "solana:mainnet")
                .put("publicKey", Base64.encodeToString(session.publicKey, Base64.NO_WRAP))
                .put("authToken", session.authToken).put("walletUri", session.walletUri ?: "")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            cipher.updateAAD(associatedData)
            val encrypted = cipher.iv + cipher.doFinal(json.toString().toByteArray(Charsets.UTF_8))
            val stream = file.startWrite()
            try {
                stream.write(encrypted)
                file.finishWrite(stream)
            } catch (failure: Exception) {
                file.failWrite(stream)
                throw failure
            }
        } catch (_: Exception) {
            throw WalletFailure("storage")
        }
    }

    fun clear() {
        file.delete()
        if (file.baseFile.exists()) throw WalletFailure("storage")
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .setKeySize(256)
                .build())
        }.generateKey()
    }
}

private fun safeWalletUri(value: String?): String? {
    if (value == null) return null
    val uri = Uri.parse(value)
    if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null || uri.fragment != null) {
        throw WalletFailure("invalid_response")
    }
    return uri.toString()
}

private fun base58(bytes: ByteArray): String {
    val alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    var value = BigInteger(1, bytes)
    val radix = BigInteger.valueOf(58)
    val result = StringBuilder()
    while (value.signum() > 0) {
        val division = value.divideAndRemainder(radix)
        result.append(alphabet[division[1].toInt()])
        value = division[0]
    }
    bytes.takeWhile { it == 0.toByte() }.forEach { _ -> result.append('1') }
    return result.reverse().toString()
}

/** Mato transactions have one wallet signer. Validate its fee payer before launching MWA. */
private fun validateTransaction(transaction: ByteArray, expectedKey: ByteArray) {
    if (transaction.size !in 100..1232 || transaction[0].toInt() != 1) throw WalletFailure("invalid_transaction")
    var offset = 65 // compact-u16 signature count 1, followed by its 64-byte slot
    val versionOrHeader = transaction[offset].toInt() and 0xff
    if (versionOrHeader and 0x80 != 0) {
        if (versionOrHeader != 0x80) throw WalletFailure("invalid_transaction")
        ++offset
    }
    if (transaction[offset].toInt() != 1) throw WalletFailure("invalid_transaction")
    offset += 3 // message header
    var count = 0
    var shift = 0
    do {
        if (offset >= transaction.size || shift > 14) throw WalletFailure("invalid_transaction")
        val byte = transaction[offset++].toInt() and 0xff
        count = count or ((byte and 0x7f) shl shift)
        shift += 7
    } while (byte and 0x80 != 0)
    if (count < 1 || offset + count * 32 + 32 >= transaction.size ||
        !transaction.copyOfRange(offset, offset + 32).contentEquals(expectedKey)) {
        throw WalletFailure("account_changed")
    }
}
