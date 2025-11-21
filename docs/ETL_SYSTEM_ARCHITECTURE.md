# ETL System Architecture & Documentation

This document outlines the complete architecture of the ETL (Extract, Transform, Load) system, including data ingestion, company normalization, contact creation, signal detection, and background processing.

## 1. System Overview

The system is designed to ingest large CSV files containing professional contact data, normalize company information, create or update contact records, and detect "signals" (mentions of specific technologies or processes) within the contact's profile data.

**Key Components:**
*   **Ingestion**: CSV Upload -> `import_batches` -> `import_rows`.
*   **Processing**: Vercel Cron -> API Route -> PL/pgSQL Functions.
*   **Normalization**: Robust company name cleaning and deduplication.
*   **Signal Detection**: Keyword matching against `dictionary_processes` and `dictionary_products`.

---

## 2. Data Ingestion Flow

### 2.1. Upload (`app/actions/ingest.ts`)
*   Users upload CSV files via the Admin UI.
*   The file is parsed in chunks (default 500 rows) to avoid memory issues.
*   **`import_batches`**: A record is created for the file upload.
*   **`import_rows`**: Each row from the CSV is stored as a JSONB object in this table with status `pending`.

### 2.2. Background Processing (`app/api/cron/process-queue/route.ts`)
*   **Trigger**: A Vercel Cron Job runs every minute.
*   **Continuous Loop**: The API route enters a loop for ~55 seconds.
    *   It calls `process_pending_queue` (which calls `process_import_batch`).
    *   It processes a batch (default 10 rows).
    *   If successful, it waits 1 second and repeats.
    *   If the queue is empty, it waits 5 seconds before checking again.
*   **Concurrency**: Uses `FOR UPDATE SKIP LOCKED` in SQL to allow multiple workers (if scaled) to process the queue without conflicts.

---

## 3. Core Processing Logic (`process_import_batch`)

Located in `scripts/025_fix_empty_linkedin_deduplication.sql`.

For each row in `import_rows`:

1.  **Company Upsert**:
    *   Calls `upsert_company` for the current company.
    *   Calls `upsert_company` for up to 6 previous positions found in the row.
2.  **Contact Upsert**:
    *   **Identity**: The `linkedin_url` is the primary key.
    *   **Empty LinkedIn Handling**: If `linkedin_url` is missing, a unique placeholder (`placeholder:UUID`) is generated to treat it as a unique contact.
    *   **Data**: Updates personal info, current position, and previous positions (stored as JSONB).
3.  **Signal Detection**:
    *   Calls `process_contact_signals` immediately after creating/updating the contact.
4.  **Status Update**:
    *   Marks the row as `processed` or `failed`.
    *   Updates the batch statistics (`processed_rows`, `failed_rows`).

---

## 4. Company Normalization & Creation (`upsert_company`)

Located in `scripts/026_robust_company_normalization.sql`.

### 4.1. Normalization (`normalize_company_name`)
*   **Cleaning**: Trims whitespace, converts to lowercase.
*   **Garbage Removal**: Returns `NULL` for values like "-", "empty", "n/a".
*   **Suffix Removal**: Removes corporate suffixes like "S.A.", "Inc.", "L.L.C." to unify "IBM Inc." and "IBM".

### 4.2. Upsert Strategy
1.  **LinkedIn Match (Priority 1)**:
    *   Searches for an existing company with the exact `linkedin_url`.
    *   If found, updates metadata (website, industry, etc.) and returns ID.
2.  **Normalized Name Match (Priority 2)**:
    *   If no URL match, searches by `normalized_name`.
    *   If found, associates the new LinkedIn URL with the existing company.
3.  **Creation**:
    *   If no match, creates a new company.
    *   If the name is "garbage" but a LinkedIn URL exists, attempts to extract a name from the URL (e.g., `linkedin.com/company/ibm` -> "IBM").

---

## 5. Signal Detection (`process_contact_signals`)

Located in `scripts/022_consolidated_fix.sql`.

Scans the contact's profile for keywords defined in `dictionary_processes` and `dictionary_products`.

### 5.1. Deduplication Rules
*   **Constraint**: `UNIQUE (contact_id, company_id, signal_type, signal_id)`.
*   **Logic**: A contact can have multiple signals for the *same company*, but only **one signal per specific dictionary term**.
    *   *Example*: "SAP" and "Oracle" for Company A -> OK (2 signals).
    *   *Example*: "SAP" in Headline and "SAP" in About for Company A -> Deduplicated (1 signal).

### 5.2. Prioritization
If a keyword appears in multiple fields, the signal is created based on the highest priority source:
1.  **Current Position Title** (Highest confidence)
2.  **Headline**
3.  **About Section** (Lowest confidence)

### 5.3. Previous Positions
*   Signals are also detected in previous positions.
*   Marked with `is_current_employee = FALSE`.

---

## 6. Admin Tools

### 6.1. Manual Merge
*   Allows admins to merge two companies manually.
*   Moves all contacts, signals, and bookmarks to the target company.
*   Deletes the source company.

### 6.2. Auto-Merge (`auto_merge_safe_duplicates`)
Located in `scripts/028_auto_merge_logic.sql`.

*   Identifies groups of companies with the same `normalized_name`.
*   **Safe Logic**:
    *   Merges only if there is **at most one unique LinkedIn URL** in the group.
    *   If multiple different LinkedIn URLs exist (e.g., "Apple Inc" vs "Apple Corps"), it skips the group to avoid false positives.
*   **Master Selection**:
    *   Prefers the record with a LinkedIn URL.
    *   Tie-breaker: Longest name (e.g., "Cencosud S.A." > "Cencosud").
