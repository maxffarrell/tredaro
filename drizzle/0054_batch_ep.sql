-- Backfill job.estimate_id for jobs created by estimate approval before the
-- applyDecision link was written.
update job j
set estimate_id = e.id
from estimate e
where e.job_id = j.id
  and j.estimate_id is null;
