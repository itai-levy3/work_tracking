-- Add status column to work_hours table
ALTER TABLE public.work_hours 
ADD COLUMN status TEXT DEFAULT 'worked' CHECK (status IN ('worked', 'sick', 'vacation', 'not_worked'));