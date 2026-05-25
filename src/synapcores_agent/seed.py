"""Seed the agent's brain with a small, realistic support corpus.

Used by ``python -m synapcores_agent --seed`` and by the demo / tests so a
fresh SynapCores has something to recall and retrieve against.
"""

from __future__ import annotations

from .brain import Brain

KB_ARTICLES = [
    (
        "Resetting your password",
        "If you cannot sign in because your password is wrong, click the "
        "'Forgot password' link on the sign-in page. We email a reset link "
        "that is valid for 30 minutes. Check spam if it does not arrive.",
    ),
    (
        "Why am I locked out of my account",
        "Accounts lock for 15 minutes after 5 failed sign-in attempts as a "
        "security measure. Wait 15 minutes and try again, or reset your "
        "password to clear the lock immediately.",
    ),
    (
        "Updating your billing card",
        "Go to Settings > Billing > Payment method to add or replace a card. "
        "Changes apply to your next invoice. We never charge a new card "
        "without your confirmation.",
    ),
    (
        "Exporting your data",
        "Settings > Data > Export produces a ZIP of your account data within "
        "a few minutes. We email a download link when it is ready. Exports "
        "are available on all plans.",
    ),
    (
        "Refund policy",
        "Monthly plans are refundable within 7 days of a charge. Annual plans "
        "are refundable within 30 days, prorated. Contact support with your "
        "invoice number to request a refund.",
    ),
]

PAST_TICKETS = [
    (
        "Login fails with correct password",
        "Customer is sure their password is correct but sign-in keeps failing.",
        "Caps Lock was on, and the account had been auto-locked. We had them "
        "reset the password via the Forgot password link, which cleared the "
        "lock and let them back in.",
    ),
    (
        "Reset email never arrives",
        "Customer requested a password reset email but it never showed up.",
        "The reset email was in the spam folder. We also confirmed the "
        "address on file and resent it; whitelisting our domain fixed future "
        "deliverability.",
    ),
    (
        "Double charged on card",
        "Customer says they were charged twice this month.",
        "An old card and a new card were both on file. We removed the stale "
        "card, refunded the duplicate charge, and the next invoice was correct.",
    ),
    (
        "Cannot find data export",
        "Customer cannot locate where to download their data.",
        "Walked them to Settings > Data > Export; the download link was "
        "emailed once the ZIP finished building.",
    ),
]


def seed(brain: Brain) -> dict:
    """Populate the KB and ticket history. Returns counts."""
    brain.ensure_schema()
    kb = 0
    for title, body in KB_ARTICLES:
        brain.add_kb_doc(title, body)
        kb += 1
    tk = 0
    for subj, prob, res in PAST_TICKETS:
        brain.add_ticket(subj, prob, res)
        tk += 1
    return {"kb_articles": kb, "tickets": tk}
