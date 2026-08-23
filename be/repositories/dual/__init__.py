"""
be/repositories/dual
Dual-write (shadow-mode) wrappers for HRFlow repositories.
Executes authoritative reads/writes on primary (Google Sheets) while
asynchronously replicating writes to shadow SQL storage with discrepancy logging.
"""
