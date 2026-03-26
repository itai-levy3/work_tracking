-- Add start_time and end_time columns to work_hours table
ALTER TABLE public.work_hours 
ADD COLUMN start_time time,
ADD COLUMN end_time time;

-- Change hours_per_day to be a JSONB object with hours for each day
ALTER TABLE public.user_settings
DROP COLUMN hours_per_day,
ADD COLUMN hours_per_day jsonb NOT NULL DEFAULT '{"monday": 8, "tuesday": 8, "wednesday": 8, "thursday": 8, "friday": 8, "saturday": 0, "sunday": 0}'::jsonb;

-- Update work_days default to include Sunday
ALTER TABLE public.user_settings
ALTER COLUMN work_days SET DEFAULT '{"monday": true, "tuesday": true, "wednesday": true, "thursday": true, "friday": true, "saturday": false, "sunday": false}'::jsonb;