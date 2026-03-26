-- Drop the existing check constraint
ALTER TABLE work_hours DROP CONSTRAINT IF EXISTS work_hours_status_check;

-- Add the updated check constraint with 'holiday' included
ALTER TABLE work_hours ADD CONSTRAINT work_hours_status_check 
CHECK (status IN ('worked', 'sick', 'vacation', 'not_worked', 'holiday'));