import { describe, expect, it } from 'vitest'
import {
  getActivePositionHistoryRange,
  getClosedPositionHistoryRange,
  hasPositionHistoryRange,
  positionHistoryRangeKey,
} from './history'

const position = {
  startSlot: 1_000n,
  lastUpdateSlot: 1_000n,
  remainingSlots: 100,
  pausedAtSlot: 0n,
}

describe('position history ranges', () => {
  it('loads active history through the current slot and includes its market update', () => {
    expect(getActivePositionHistoryRange(position, 1_050)).toEqual({
      startSlot: 1_000,
      endSlot: 1_050,
      includeEndSlot: true,
      live: true,
    })
  })

  it('stops completed history at settlement and excludes the exit price jump', () => {
    expect(getActivePositionHistoryRange(position, 1_150)).toEqual({
      startSlot: 1_000,
      endSlot: 1_100,
      includeEndSlot: false,
      live: false,
    })
  })

  it('freezes paused history at the pause even after the former end has passed', () => {
    expect(
      getActivePositionHistoryRange(
        {
          ...position,
          lastUpdateSlot: 1_040n,
          remainingSlots: 60,
          pausedAtSlot: 1_040n,
        },
        1_200,
      ),
    ).toEqual({
      startSlot: 1_000,
      endSlot: 1_040,
      includeEndSlot: false,
      live: false,
    })
  })

  it('preserves the original start after resuming with a later scheduled end', () => {
    expect(
      getActivePositionHistoryRange(
        { ...position, lastUpdateSlot: 1_200n, remainingSlots: 60 },
        1_230,
      ),
    ).toEqual({
      startSlot: 1_000,
      endSlot: 1_230,
      includeEndSlot: true,
      live: true,
    })
  })

  it('requires a current slot for a running stream but not for a paused one', () => {
    expect(getActivePositionHistoryRange(position, null).endSlot).toBeNull()
    expect(
      getActivePositionHistoryRange({ ...position, pausedAtSlot: 1_040n }, null)
        .endSlot,
    ).toBe(1_040)
    expect(getActivePositionHistoryRange(position, 999).endSlot).toBeNull()
  })

  it('uses the earlier of closure and recorded end for closed positions', () => {
    expect(
      getClosedPositionHistoryRange({
        start_slot: 1_000,
        end_slot: 1_100,
        slot: 1_050,
      }),
    ).toEqual({
      startSlot: 1_000,
      endSlot: 1_050,
      includeEndSlot: false,
      live: false,
    })
    expect(
      getClosedPositionHistoryRange({
        start_slot: 1_000,
        end_slot: 1_100,
        slot: 1_150,
      }).endSlot,
    ).toBe(1_100)
  })

  it('does not fabricate ranges for receipts without usable slot boundaries', () => {
    for (const event of [
      { start_slot: null, end_slot: 1_100, slot: 1_150 },
      { start_slot: 1_000, end_slot: null, slot: 1_150 },
      { start_slot: 1_000, end_slot: 1_100, slot: Number.NaN },
      { start_slot: 1_200, end_slot: 1_100, slot: 1_150 },
      { start_slot: -1, end_slot: 1_100, slot: 1_150 },
    ]) {
      const range = getClosedPositionHistoryRange(event)
      expect(hasPositionHistoryRange(range.startSlot, range.endSlot)).toBe(
        false,
      )
    }
    expect(hasPositionHistoryRange(1, Number.MAX_SAFE_INTEGER + 1)).toBe(false)
    expect(hasPositionHistoryRange(1, Number.NaN)).toBe(false)
  })
})

describe('position history query identity', () => {
  it('keeps the chart cached between live ticks and distinguishes stopped ranges', () => {
    const live = getActivePositionHistoryRange(position, 1_050)
    expect(positionHistoryRangeKey(live)).toEqual(
      positionHistoryRangeKey(getActivePositionHistoryRange(position, 1_060)),
    )
    expect(positionHistoryRangeKey(live)).not.toEqual(
      positionHistoryRangeKey(getActivePositionHistoryRange(position, 1_100)),
    )
    expect(
      positionHistoryRangeKey({ ...live, rangeKey: 'position-a' }),
    ).not.toEqual(positionHistoryRangeKey({ ...live, rangeKey: 'position-b' }))
  })
})
