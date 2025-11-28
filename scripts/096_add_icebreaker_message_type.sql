-- Add message_type column to user_icebreakers
-- Values: 'linkedin' or 'email'

ALTER TABLE user_icebreakers 
ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'linkedin';

-- Add check constraint
ALTER TABLE user_icebreakers 
DROP CONSTRAINT IF EXISTS user_icebreakers_message_type_check;

ALTER TABLE user_icebreakers 
ADD CONSTRAINT user_icebreakers_message_type_check 
CHECK (message_type IN ('linkedin', 'email'));

-- Create index for faster queries by message type
CREATE INDEX IF NOT EXISTS idx_user_icebreakers_message_type 
ON user_icebreakers(message_type);
