# Q3 FY26 Pipeline Review

Prepared from CRM opportunity and account data as of **August 14, 2026**. Figures reflect the `Closed Won` and `Commit` stages unless otherwise noted.

## Executive Summary

Pipeline coverage finished the quarter at 3.1x against a $42.0M target, down from 3.6x in Q2. The decline is concentrated in Enterprise, where three deals slipped past the quarter boundary. Mid-Market performance was strong and offset roughly half of the Enterprise shortfall.

Net new ARR closed at $13.8M against a $14.5M target, a 95% attainment. Renewal rates held steady at 91%, and expansion revenue grew 12% quarter over quarter.

## Pipeline by Segment


| Segment    | Opportunities | Pipeline    | Weighted   | Close Rate |
| ---------- | ------------- | ----------- | ---------- | ---------- |
| Enterprise | 47            | $58.2M      | $19.4M     | 22%        |
| Mid-Market | 132           | $41.7M      | $16.8M     | 31%        |
| SMB        | 389           | $30.3M      | $12.1M     | 38%        |
| **Total**  | **568**       | **$130.2M** | **$48.3M** | **29%**    |


Enterprise carries the largest absolute pipeline but the weakest conversion. The 22% close rate is below the 26% trailing-four-quarter average, and it is the single largest contributor to the coverage decline.

## Regional Performance


| Region | Bookings | Target | Attainment | QoQ  |
| ------ | -------- | ------ | ---------- | ---- |
| AMER   | $8.1M    | $8.4M  | 96%        | +4%  |
| EMEA   | $3.9M    | $4.2M  | 93%        | -2%  |
| APAC   | $1.8M    | $1.9M  | 95%        | +11% |


APAC posted the strongest quarter-over-quarter growth despite the smallest absolute contribution. EMEA was the only region to decline, driven by a single $1.2M opportunity that slipped from the quarter.

## Stage Movement

The following query reproduces the stage-transition counts used throughout this section:

```sql
SELECT
  stage_from,
  stage_to,
  COUNT(*) AS transitions,
  SUM(amount) AS total_amount
FROM opportunity_stage_history
WHERE changed_at >= '2026-05-01'
  AND changed_at <  '2026-08-01'
GROUP BY stage_from, stage_to
ORDER BY total_amount DESC;
```

Three patterns stand out in the transition data:

1. Movement from `Proposal` to `Negotiation` slowed by 18% relative to Q2.
2. Backward transitions from `Negotiation` to `Discovery` nearly doubled, concentrated in Enterprise.
3. Time-in-stage for `Commit` rose from 11 days to 17 days.

## Slipped Opportunities

Three Enterprise deals slipped past the quarter boundary:

- **Northwind Logistics** — $2.4M, moved from `Commit` to `Negotiation` on July 28
- **Meridian Health Systems** — $1.9M, security review extended
- **Calderon Group** — $1.2M, procurement freeze through September

All three remain active and are forecast to close in Q4. Combined, they represent $5.5M, which would have brought attainment to 133% had they closed in the quarter.

## Data Quality Notes

> Approximately 4% of opportunity records carry a null `close_date` and are excluded from all forecast calculations in this document.

Two additional caveats apply to the figures above:

- Accounts merged during the quarter are attributed to the surviving record, which understates historical AMER performance by roughly $200K.
- Currency conversion uses the rate at close, not the rate at open.

## Recommendations

1. Institute a mandatory deal review at the `Negotiation` stage for Enterprise opportunities above $1M.
2. Investigate the increase in time-in-stage for `Commit`, which is the clearest leading indicator of slip risk.
3. Revisit Enterprise close-rate assumptions in the Q4 forecast model, since the 26% trailing average now looks optimistic.
