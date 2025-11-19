-- Create table for tracking import batches
CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  total_rows INTEGER DEFAULT 0,
  processed_rows INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create table for raw import rows
CREATE TABLE IF NOT EXISTS import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES import_batches(id) ON DELETE CASCADE NOT NULL,
  row_data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;

-- Policies for import_batches
CREATE POLICY "Users can view their own batches"
  ON import_batches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Superadmins can view all batches"
  ON import_batches FOR SELECT
  USING (is_superadmin());

CREATE POLICY "Users can insert their own batches"
  ON import_batches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policies for import_rows
CREATE POLICY "Users can view their own rows"
  ON import_rows FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM import_batches
      WHERE import_batches.id = import_rows.batch_id
      AND import_batches.user_id = auth.uid()
    )
  );

CREATE POLICY "Superadmins can view all rows"
  ON import_rows FOR SELECT
  USING (is_superadmin());

CREATE POLICY "Users can insert their own rows"
  ON import_rows FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM import_batches
      WHERE import_batches.id = import_rows.batch_id
      AND import_batches.user_id = auth.uid()
    )
  );

-- Indexes for performance
CREATE INDEX idx_import_rows_batch_id ON import_rows(batch_id);
CREATE INDEX idx_import_rows_status ON import_rows(status);
CREATE INDEX idx_import_batches_user_id ON import_batches(user_id);
