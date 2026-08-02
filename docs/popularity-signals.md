# Popularity signals

BuzzRouter treats popularity, trust, and activity as separate concepts:

- **Popularity** measures demonstrated visitor demand.
- **Trust** measures whether a listing is technically verified and supported by
  public discovery evidence.
- **Activity** measures observable community participation when comparable,
  privacy-safe data becomes available.

Trust is an eligibility requirement, not a popularity boost. Relay uptime,
protocol support, source count, and Link enrollment must not make a community look
popular.

## First public score

The first popularity score should use 30 days of first-party directory behavior:

| Signal | Weight | Collection |
| --- | ---: | --- |
| Unique join intents | 65% | Clicks that attempt to open or join a community |
| Unique detail viewers | 25% | Visitors who select a community result |
| Authenticated endorsements | 10% | One current endorsement per Nostr pubkey |

Events are deduplicated per community and day with a rotating keyed fingerprint.
Raw IP addresses and full user-agent strings are never stored. Counts use
logarithmic scaling so large communities do not permanently dominate, and an
exponential decay with a 14-day half-life so current interest matters.

The public product should show understandable buckets such as `Trending`,
`Popular`, and `Established`, plus the underlying 30-day join-intent count. It
should not expose a false-precision score.

## Abuse resistance

- Exclude known crawlers and prefetch requests.
- Rate-limit repeated events before aggregation.
- Require a minimum sample before assigning a popularity label.
- Keep authenticated endorsements to one per pubkey and do not weight them by
  payment.
- Detect sudden single-source traffic spikes and hold them out for review.
- Publish the formula and score components on a methodology page.

Raw relay message counts are excluded. They are incomplete across private and
authenticated communities and would reward spam. Ratings are also excluded from
the initial score until identity, moderation, and brigading controls exist.

## Rollout

1. Collect join and detail signals without changing rank for 30 days.
2. Compare the score against manual review and remove obvious bot traffic.
3. Add a `Popular` sort after the sample is credible.
4. Add Nostr-authenticated endorsements as a separate, auditable component.
