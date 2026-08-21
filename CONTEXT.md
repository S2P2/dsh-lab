# DSH Lab

DSH Lab experiments with deterministic extensions around DeepSeek Harness. This glossary names the product/domain concepts shared by those experiments without prescribing their implementation.

## Language

**Provider Quota**:
Account-level model capacity reported by an external model provider, independent of any single DSH session or conversation.
_Avoid_: Session quota, context usage

**Quota Window**:
One provider-defined allowance period, represented by a usage percentage and an optional reset time.
_Avoid_: Context window

**Quota Status**:
The most recent successfully observed set of Provider Quota windows for a provider.
_Avoid_: Session stats, token stats

**Stale Quota Status**:
A Quota Status retained after a refresh failure; it remains useful last-known information but must be distinguishable from fresh status.
_Avoid_: Failed quota, unavailable quota
