import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Drawer } from './Drawer'
import { Button, Text } from './ui'
import { colors } from '@/theme'

const riskAcknowledgementKey = 'mato:risk-acknowledged:v1'

export function FirstVisit() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let mounted = true
    void AsyncStorage.getItem(riskAcknowledgementKey)
      .then((value) => {
        if (mounted) setVisible(value !== 'true')
      })
      .catch(() => {
        if (mounted) setVisible(true)
      })
    return () => {
      mounted = false
    }
  }, [])
  return (
    <Drawer
      visible={visible}
      title="Mato is experimental"
      onClose={() => {}}
      dismissible={false}
    >
      <Text style={{ color: colors.secondary, lineHeight: 24 }}>
        Liquidity is low and the smart contracts aren't fully audited yet. You
        could lose some or all of the funds you trade.
      </Text>
      <Button
        title="I understand the risks"
        onPress={() => {
          setVisible(false)
          // Acceptance remains valid for this session if local storage is unavailable.
          void AsyncStorage.setItem(riskAcknowledgementKey, 'true').catch(
            () => {},
          )
        }}
      />
    </Drawer>
  )
}
