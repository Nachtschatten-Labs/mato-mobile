/// Compile-time deployment configuration. Never store wallet secrets here.
class AppConfig {
  const AppConfig({
    this.readApiUrl = defaultReadApiUrl,
    this.rpcUrl = defaultRpcUrl,
    this.transactionsEnabled = true,
  });

  factory AppConfig.fromEnvironment() {
    const enabled = String.fromEnvironment(
      'ENABLE_TRANSACTIONS',
      defaultValue: 'true',
    );
    const verified = String.fromEnvironment(
      'VERIFIED_PROGRAM_ID',
      defaultValue: programId,
    );
    return AppConfig(
      readApiUrl: validateEndpoint(
        const String.fromEnvironment(
          'READ_API_URL',
          defaultValue: defaultReadApiUrl,
        ),
        'Read API',
      ),
      rpcUrl: validateEndpoint(
        const String.fromEnvironment('RPC_URL', defaultValue: defaultRpcUrl),
        'RPC',
      ),
      transactionsEnabled: enabled == 'true' && verified == programId,
    );
  }

  static const programId = 'TwobwMYkKbT8uMWqgPrEPXTPoyYsKAPmaWun6T2WT4A';
  static const mainnetGenesisHash =
      '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
  static const defaultReadApiUrl =
      'https://read-api-production-f8ea.up.railway.app';
  static const defaultRpcUrl = 'https://api.mainnet-beta.solana.com';
  static const chain = 'solana:mainnet';
  final String readApiUrl;
  final String rpcUrl;
  final bool transactionsEnabled;

  static String validateEndpoint(String raw, String label) {
    final uri = Uri.tryParse(raw);
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasFragment) {
      throw FormatException(
        '$label must be an HTTPS URL without embedded credentials or fragments.',
      );
    }
    return raw.replaceFirst(RegExp(r'/+$'), '');
  }
}

String normalizeReadApiBaseUrl(String raw) {
  var value = raw.trim();
  if (value.isEmpty) {
    throw const FormatException('Market data service is not configured');
  }
  if (!RegExp(r'^[a-z][a-z\d+.-]*://', caseSensitive: false).hasMatch(value)) {
    value = 'https://${value.replaceFirst(RegExp(r'^//'), '')}';
  }
  final uri = Uri.parse(value);
  if (!['http', 'https'].contains(uri.scheme) ||
      uri.host.isEmpty ||
      uri.userInfo.isNotEmpty) {
    throw const FormatException(
      'Read API must be an HTTP(S) URL without embedded credentials',
    );
  }
  var path = uri.path.replaceFirst(RegExp(r'/+$'), '');
  if (path.endsWith('/v1')) path = path.substring(0, path.length - 3);
  return uri
      .replace(path: path, fragment: '')
      .toString()
      .replaceFirst(RegExp(r'#$'), '')
      .replaceFirst(RegExp(r'/$'), '');
}
