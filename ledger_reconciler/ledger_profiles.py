"""Column-name profiles for the ledger exports of the accounting platforms
most small US/UK/AU clients actually use, so onboarding a new client on a
platform we already support is a config lookup, not a rewrite.

Sourced against real documented export formats where confirmed:
- Xero "Account Transactions" export: Account Code, Credit, Debit,
  Description, Reference, Source.
- Wave transaction export: Date, Description, Amount.
- FreshBooks expense export: Date, Vendor, Category, Amount, Currency, Tax.
- QuickBooks Online "Transaction List by Date": the well-established common
  column set (Date, Transaction Type, Num, Name, Memo/Description, Account,
  Amount) — NOT independently confirmed against a live export the way the
  other three were. Treat this one profile as lower-confidence; if a real
  QuickBooks export doesn't match, it's a one-line alias fix here, not code.

Each profile lists ALIASES per logical field (matched case-insensitively
against the header row), same idea as the multiple label patterns in
extract.py — a platform's exact wording varies by region/version, so we
match on a short list of known variants rather than one exact string.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class LedgerProfile:
    name: str
    date_aliases: tuple[str, ...]
    description_aliases: tuple[str, ...]
    amount_aliases: tuple[str, ...] = ()
    debit_aliases: tuple[str, ...] = ()   # used instead of amount_aliases when
    credit_aliases: tuple[str, ...] = ()  # the platform splits debit/credit
    reference_aliases: tuple[str, ...] = ()

    @property
    def uses_debit_credit_split(self) -> bool:
        return bool(self.debit_aliases or self.credit_aliases)


PROFILES: list[LedgerProfile] = [
    LedgerProfile(
        name="Xero",
        date_aliases=("date",),
        description_aliases=("description",),
        debit_aliases=("debit",),
        credit_aliases=("credit",),
        reference_aliases=("reference",),
    ),
    LedgerProfile(
        name="Wave",
        date_aliases=("date",),
        description_aliases=("description",),
        amount_aliases=("amount",),
    ),
    LedgerProfile(
        name="FreshBooks",
        date_aliases=("date",),
        description_aliases=("vendor", "category"),
        amount_aliases=("amount",),
    ),
    LedgerProfile(
        name="QuickBooks",  # lower confidence — see module docstring
        date_aliases=("date",),
        description_aliases=("memo/description", "memo", "description", "name"),
        amount_aliases=("amount",),
        reference_aliases=("num",),
    ),
    LedgerProfile(
        name="Generic",  # the plain Date/Description/Reference/Amount shape
        date_aliases=("date",),
        description_aliases=("description",),
        amount_aliases=("amount",),
        reference_aliases=("reference",),
    ),
]


def _first_match(headers: list[str], aliases: tuple[str, ...]) -> int | None:
    for alias in aliases:
        if alias in headers:
            return headers.index(alias)
    return None


def _try_profile(profile: LedgerProfile, headers: list[str]) -> dict[str, int] | None:
    date_i = _first_match(headers, profile.date_aliases)
    desc_i = _first_match(headers, profile.description_aliases)
    if date_i is None or desc_i is None:
        return None

    cols = {"date": date_i, "description": desc_i}

    if profile.uses_debit_credit_split:
        debit_i = _first_match(headers, profile.debit_aliases)
        credit_i = _first_match(headers, profile.credit_aliases)
        if debit_i is None and credit_i is None:
            return None
        if debit_i is not None:
            cols["debit"] = debit_i
        if credit_i is not None:
            cols["credit"] = credit_i
    else:
        amount_i = _first_match(headers, profile.amount_aliases)
        if amount_i is None:
            return None
        cols["amount"] = amount_i

    ref_i = _first_match(headers, profile.reference_aliases)
    if ref_i is not None:
        cols["reference"] = ref_i

    return cols


def detect_profile(headers: list[str]) -> tuple[LedgerProfile, dict[str, int]] | None:
    """Tries every profile and returns whichever one resolves the MOST
    columns, not just the first whose bare minimum is satisfied. A generic
    Date/Description/Reference/Amount sheet also happens to satisfy Wave's
    (looser) requirements, for example — picking by first-match-wins would
    silently drop the reference column that was actually there. ``headers``
    must already be lowercased/stripped."""
    best: tuple[LedgerProfile, dict[str, int]] | None = None
    for profile in PROFILES:
        cols = _try_profile(profile, headers)
        if cols is None:
            continue
        if best is None or len(cols) > len(best[1]):
            best = (profile, cols)
    return best
