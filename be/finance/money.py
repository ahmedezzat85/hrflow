"""
be/finance/money.py
Column types for money (database redesign, Stage 5b): exact decimal in the database, plain floats in Python.

PostgreSQL stores these as NUMERIC, so sums and comparisons in SQL are exact (a binary float cannot hold 0.1 exactly and its
sums drift). With asdecimal=False SQLAlchemy hands the application a float exactly as before, so no Python arithmetic changes.

Money     18 digits, 4 after the point: amounts, totals and balances. Four, not two, because the application already stores
          balances to 4 places and converted amounts can have more than 2; a 2-place column would round them silently.
Rate      18 digits, 8 after the point: exchange rates and percentages.
Quantity  18 digits, 4 after the point: line quantities (may be fractional).
"""
from sqlalchemy import Numeric

Money = Numeric(18, 4, asdecimal=False)
Rate = Numeric(18, 8, asdecimal=False)
Quantity = Numeric(18, 4, asdecimal=False)
