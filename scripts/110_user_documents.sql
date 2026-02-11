-- ============================================================
-- Feature: Docs - User Document Management & Value Profiling
-- Creates tables for document storage, tag extraction, and
-- consolidated value profiles. Also creates the Supabase
-- Storage bucket with RLS policies.
-- ============================================================

-- 1. Create enum types
DO $$ BEGIN
  CREATE TYPE document_type AS ENUM ('pdf', 'pptx', 'docx', 'url');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE document_status AS ENUM ('uploading', 'processing', 'ready', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE tag_type AS ENUM ('industry', 'technology', 'process');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Create user_documents table
CREATE TABLE IF NOT EXISTS user_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  type document_type NOT NULL,
  source_url text,
  storage_path text,
  file_size bigint,
  status document_status NOT NULL DEFAULT 'uploading',
  processing_error text,
  extracted_text text,
  ai_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_documents_user_id ON user_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_documents_status ON user_documents(status);

-- RLS
ALTER TABLE user_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own documents"
  ON user_documents FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Create document_tags table
CREATE TABLE IF NOT EXISTS document_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES user_documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tag_type tag_type NOT NULL,
  tag_value text NOT NULL,
  tag_reference_id uuid,
  confidence real NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_document_tags_document_id ON document_tags(document_id);
CREATE INDEX IF NOT EXISTS idx_document_tags_user_id ON document_tags(user_id);
CREATE INDEX IF NOT EXISTS idx_document_tags_type ON document_tags(tag_type);
CREATE INDEX IF NOT EXISTS idx_document_tags_value ON document_tags(tag_value);

-- RLS
ALTER TABLE document_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own document tags"
  ON document_tags FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. Create user_value_profiles table
CREATE TABLE IF NOT EXISTS user_value_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_summary text,
  target_industries jsonb DEFAULT '[]'::jsonb,
  target_technologies jsonb DEFAULT '[]'::jsonb,
  target_processes jsonb DEFAULT '[]'::jsonb,
  raw_analysis jsonb,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_value_profile UNIQUE (user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_value_profiles_user_id ON user_value_profiles(user_id);

-- RLS
ALTER TABLE user_value_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own value profile"
  ON user_value_profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 5. Create Supabase Storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-documents',
  'user-documents',
  false,
  52428800, -- 50MB
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies
CREATE POLICY "Users can upload their own documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'user-documents' 
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can view their own documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'user-documents' 
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete their own documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'user-documents' 
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
