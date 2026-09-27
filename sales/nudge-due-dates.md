# Nudge-due lookup — precomputed (read-only reference)

(See ledger note for session provenance. The earlier "P-020 does not exist"
remark is superseded: session 5 filled P-020–P-025 at the same evidence bar.)

**All 38 rows are SENT-eligible** (validated 2026-09-18 by
`sales/nudge-precompute.mjs`: 53 rows, 0 problems; S10 added P-048–P-053). When send evidence
arrives, the row records: **nudge-due = sent + 5 business days**.

## Calendar view — every row (as of 2026-09-17)

All rows are `DRAFTED / PENDING` as of this file's update: **no row has a
sent-date or a recorded nudge-due yet**. A nudge date exists only at the
SENT transition (it is never pre-assigned). The "nudge-due" column shows
what WILL be recorded for the stated send date.

| row | prospect | status | sent-date | nudge-due if sent 2026-09-17 (Thu) | nudge-due if sent 2026-09-18 (Fri) |
| --- | --- | --- | --- | --- | --- |
| P-001 | MainStreet Fudge & Popcorn Co | SENT | — | 2026-09-21 | 2026-09-28 |
| P-002 | Holmes County Pottery | SENT/SENT | — | 2026-09-23 | 2026-09-30 |
| P-003 | Lehman's | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-004 | Walnut Creek Cheese & Market | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-005 | Keim (The Keim Company) | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-006 | Homestead Furniture | SENT | — | 2026-09-21 | 2026-09-28 |
| P-007 | Murr Printing & Graphics | SENT | — | 2026-09-20 | 2026-09-30 |
| P-008 | The Barn Inn B&B | SENT | — | 2026-09-20 | 2026-09-30 |
| P-009 | The Amish Door (Milana Event Center) | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-010 | Plaid Sheep Company | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-011 | A Day in the Country B&B | SENT | — | 2026-09-19 | 2026-09-30 |
| P-012 | The Rural Thimble Quilt Retreat | SENT/SENT | — | 2026-09-23 | 2026-09-30 |
| P-013 | 1847 Quilt Retreat Center | SENT | — | 2026-09-19 | 2026-09-30 |
| P-014 | Miller's Dry Goods | CUT 2026-09-20 — never sent | — | — | — |
| P-015 | Guggisberg Swiss Inn | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-016 | Troyer's Amish Tours | SENT | — | 2026-09-20 | 2026-09-30 |
| P-017 | The White Oak Inn | SENT | — | 2026-09-21 | 2026-09-28 |
| P-018 | Uncle Tom's Cabins | SENT | — | 2026-09-20 | 2026-09-30 |
| P-019 | Mel & Mary's Cottages | SENT | — | 2026-09-20 | 2026-09-30 |
| P-020 | Country Coach Adventures | SENT | — | 2026-09-19 | 2026-09-30 |
| P-021 | American Hall Venue | SENT | — | 2026-09-19 | 2026-09-30 |
| P-022 | Dutch Craft Furniture | SENT | — | 2026-09-20 | 2026-09-30 |
| P-023 | Weaver's Fine Furniture | SENT | — | 2026-09-20 | 2026-09-30 |
| P-024 | Airport Ridge Sporting Clays | SENT | — | 2026-09-19 | 2026-09-30 |
| P-025 | The Dwelling | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-026 | Holmes Center for the Arts | SENT/SENT | — | 2026-09-23 | 2026-09-30 |
| P-027 | Butterfly Bliss Cottage | SENT/SENT | — | 2026-09-23 | 2026-09-30 |
| P-028 | Timbercrest Camp & RV Park | SENT/SENT | — | 2026-09-23 | 2026-09-30 |
| P-029 | The Amish Country Theater | SENT/SENT | — | 2026-09-23 | 2026-09-30 |
| P-030 | The Farm at Walnut Creek | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-031 | Brandywine Grove & Paradise Lake | SENT/SENT | — | 2026-09-23 | 2026-09-30 |
| P-032 | Stutzman's Lawn & Landscaping | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-033 | Fireside RV Rental – New Philadelphia | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-034 | Miller's Creamery | SENT | — | 2026-09-21 | 2026-09-28 |
| P-035 | Twin City Farmers Market | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-036 | Gregg Orthodontics | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-037 | Charged Ride | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-038 | Harvest Ridge Event Center | SENT/SENT | — | 2026-09-23 | 2026-09-30 |
| P-039 | Illusions Screen Printing | SENT | — | 2026-09-20 | 2026-09-30 |
| P-040 | Expert T's | SENT | — | 2026-09-20 | 2026-09-30 |
| P-041 | C R Blooms Floral | CUT 2026-09-20 — self-audit quarantine, never sent | — | — | — |
| P-042 | All Events Rental | SENT | — | 2026-09-21 | 2026-09-28 |
| P-043 | Mohican Adventures | SENT | — | 2026-09-21 | 2026-09-28 |
| P-044 | Coblentz Chocolate Company | SENT | — | 2026-09-21 | 2026-09-28 |
| P-045 | East Holmes Veterinary Clinic | SENT | — | 2026-09-21 | 2026-09-28 |
| P-046 | HartFelt Boarding Kennels | SENT | — | 2026-09-21 | 2026-09-28 |
| P-047 | Kline Home Exteriors | SENT | — | 2026-09-21 | 2026-09-28 |
| P-048 | First Stop Signs & Apparel | SENT | — | 2026-09-23 | 2026-09-30 |
| P-049 | Nora Event Rental Co | SENT | — | 2026-09-23 | 2026-09-30 |
| P-050 | Five Alarm Powerwash | SENT | — | 2026-09-23 | 2026-09-30 |
| P-051 | Stark Family Dental | SENT | — | 2026-09-23 | 2026-09-30 |
| P-052 | Signs to Go | DRAFTED/PENDING | — | 2026-09-24 | 2026-09-25 |
| P-053 | Baltzly Dental | SENT | — | 2026-09-23 | 2026-09-30 |

## Lookup: send date → nudge-due (5 business days, weekend-skipping)

| if sent | nudge-due | check |
| --- | --- | --- |
| 2026-09-17 (Thu) | 2026-09-24 | ok |
| 2026-09-18 (Fri) | 2026-09-25 | ok |
| 2026-09-21 (Mon) | 2026-09-28 | ok |
| 2026-09-22 (Tue) | 2026-09-29 | ok |
| 2026-09-23 (Wed) | 2026-09-30 | ok |
| 2026-09-24 (Thu) | 2026-10-01 | ok |
| 2026-09-25 (Fri) | 2026-10-02 | ok |

Recompute anytime: `node sales/nudge-precompute.mjs`
(fixed-date unit tests: `node sales/nudge-calendar.mjs --test` — 9/9 PASS)
| P-054 | Rylon Printing | SENT/SENT | — | 2026-09-23 | 2026-09-30 |
| P-055 | Wooster Glass Co. | SENT/SENT | — | 2026-09-23 | 2026-09-30 |

| P-056 | Willow Haven Lodge | SENT | — | 2026-09-23 | 2026-09-30 |
| P-057 | Century Farms - Event Venue and Inn | SENT | — | 2026-09-23 | 2026-09-30 |
| P-058 | Rustic Ridge Wedding Barn | SENT | — | 2026-09-23 | 2026-09-30 |
| P-059 | Magnolia Spring Farm | SENT | — | 2026-09-23 | 2026-09-30 |
| P-060 | Rivercrest Farm | SENT | — | 2026-09-23 | 2026-09-30 |
| P-061 | Black Run Farms | SENT | — | 2026-09-23 | 2026-09-30 |

| P-062 | Kenyon Inn & Restaurant | DRAFTED/PENDING | — | — | — |
| P-063 | Ariel-Foundation Park | DRAFTED/PENDING | — | — | — |
| P-064 | Mount Vernon Grand Hotel | DRAFTED/PENDING | — | — | — |
| P-065 | WebAct | DRAFTED/PENDING | — | — | — |
| P-066 | Snyder Advertising | DRAFTED/PENDING | — | — | — |
| P-067 | Grantstreet Creative | DRAFTED/PENDING | — | — | — |
| P-068 | TL Web Design | DRAFTED/PENDING | — | — | — |
| P-069 | aEnfinite | DRAFTED/PENDING | — | — | — |
| P-070 | Cyber Shift Technologies | DRAFTED/PENDING | — | — | — |
