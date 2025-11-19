# ETL Process Documentation

This document outlines the Extract, Transform, Load (ETL) process used to ingest data into the platform. The system uses an ELT (Extract, Load, Transform) architecture where raw data is first loaded into the database and then processed using PL/pgSQL functions for maximum performance and reliability.

## Architecture Overview

1.  **Extract & Load (Frontend -> DB Raw)**:
    *   Users upload a CSV file via the Admin UI (`/admin/ingest`).
    *   The frontend parses the CSV and uploads raw rows to the `import_rows` table in batches.
    *   A record is created in `import_batches` to track the overall progress.
    *   This step is purely for data ingestion and does not apply business logic.

2.  **Transform (Database Engine)**:
    *   Once the upload is complete, the frontend triggers a stored procedure (`process_import_batch`).
    *   This function runs entirely within the PostgreSQL database.
    *   It processes each row, handles entity creation (Companies, Contacts), and executes signal detection.

## Database Tables

### `import_batches`
Tracks the status of an import job.
- `id`: UUID (Primary Key)
- `status`: 'pending' | 'processing' | 'completed' | 'failed'
- `total_rows`: Total number of rows in the CSV.
- `processed_rows`: Number of rows successfully processed.

### `import_rows`
Stores the raw data for each row in the CSV.
- `id`: UUID (Primary Key)
- `batch_id`: Reference to `import_batches`.
- `row_data`: JSONB column containing the raw CSV data (mapped to standardized keys).
- `status`: 'pending' | 'processed' | 'failed'.

## Key Functions

### 1. `process_import_batch(p_batch_id UUID)`
**Location**: `scripts/010_ingest_logic_plpgsql.sql`
The main orchestrator function.
- Iterates through pending rows in `import_rows`.
- Calls `upsert_company` for the current company.
- Iterates through previous positions (1-6), calling `upsert_company` for each and building a `previous_positions` JSONB array with the correct `company_id`.
- Upserts the Contact record (handling missing LinkedIn URLs with placeholders).
- Calls `process_contact_signals` to generate signals.
- Updates the status of the row and the batch.

### 2. `upsert_company(p_name, ...)`
**Location**: `scripts/007_refactor_company_matching.sql`
Handles company creation and deduplication.
- Normalizes company names (removes "S.A.", "Inc", etc.) using `normalize_company_name`.
- Checks for existing companies by normalized name.
- Updates existing companies with richer data (logo, website, etc.) if provided.
- Creates new companies if no match is found.

### 3. `process_contact_signals(contact_id UUID)`
**Location**: `scripts/008_improved_signal_detection.sql`
Detects technology and process signals in contact profiles.
- Scans `headline`, `about`, and `current_position_description` for keywords from the Dictionary.
- Scans `previous_positions` descriptions and titles.
- **Crucial**: Assigns the detected signal to the correct `company_id`.
    - Signals in current position -> `current_company_id`.
    - Signals in previous positions -> `company_id` stored in the `previous_positions` JSONB object.

## Frontend Actions (`app/actions/ingest.ts`)

- `createImportBatch`: Initializes the batch record.
- `uploadBatchRows`: Inserts raw data into `import_rows`. Maps CSV columns (e.g., `person_linkedin_url`) to the keys expected by the database function (e.g., `linkedin_url`).
- `triggerBatchProcessing`: Calls the `process_import_batch` RPC function.
- `getBatchStatus`: Polls the database for progress updates.

## Error Handling

- **Row Level**: If a specific row fails (e.g., data validation error), the exception is caught, logged to `error_message` in `import_rows`, and the status is set to 'failed'. The batch continues processing other rows.
- **Batch Level**: The batch status reflects the overall state. 'completed' means the process finished running, even if some individual rows failed.
