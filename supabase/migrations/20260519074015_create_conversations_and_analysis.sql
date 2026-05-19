/*
  # Create conversations and analysis tables

  1. New Tables
    - `conversations`
      - `id` (uuid, primary key)
      - `title` (text) - auto-generated from first message
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    - `messages`
      - `id` (uuid, primary key)
      - `conversation_id` (uuid, foreign key)
      - `role` (text) - 'user' or 'assistant'
      - `content` (text) - message content
      - `created_at` (timestamptz)
    - `analysis_results`
      - `id` (uuid, primary key)
      - `conversation_id` (uuid, foreign key)
      - `message_id` (uuid, foreign key)
      - `case_type` (text)
      - `key_facts` (jsonb) - array of facts
      - `claims` (jsonb) - array of claims with selected status
      - `risks` (jsonb) - array of risks
      - `evidence_checklist` (jsonb) - array of evidence items with status
      - `missing_info` (jsonb) - array of missing info
      - `created_at` (timestamptz)
  2. Security
    - Enable RLS on all tables
    - Add policies for anonymous access (MVP - single page, no auth)
*/

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read conversations"
  ON conversations FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous insert conversations"
  ON conversations FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous update conversations"
  ON conversations FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  role text NOT NULL DEFAULT 'user',
  content text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read messages"
  ON messages FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous insert messages"
  ON messages FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS analysis_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  message_id uuid NOT NULL REFERENCES messages(id),
  case_type text NOT NULL DEFAULT '',
  key_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_info jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read analysis"
  ON analysis_results FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous insert analysis"
  ON analysis_results FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous update analysis"
  ON analysis_results FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
