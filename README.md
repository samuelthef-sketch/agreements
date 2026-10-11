# Digital Agreement

A simple white and blue site where a recipient reads the **Research Assignment Files and Deliverables** agreement, types their name, signs, and submits.

## How it works

- `index.html` shows the agreement form. The recipient's typed name and signature are drawn onto the form live.
- **Name check:** the typed name is checked against the recipient list in Supabase. One word of a name is enough (e.g. `Alexis`). Both Calosas must type their full name (`Ken Calosa`, `Dhapniex Calosa`). Green border = on the list, red = not on the list ("contact Sam to verify").
- **Signature pad:** draw with a finger or mouse. **Redo** clears it.
- **One submission per recipient:** once someone has submitted, typing their name again shows "You're done with this agreement" and the form won't submit.
- **Submit:** needs a verified name and a signature. If the box is not checked, a popup asks "Are you sure?" (Yes / No).
- **Save image agreement:** downloads the form as a PNG with the name and signature on it.

## Backend (Supabase)

- `public.recipients`: the list of allowed names (not readable from the browser).
- `public.submissions`: one row per submission (name, agreed yes/no, status, image path).
- Storage bucket `agreement-submissions` (private): the final signed form image for each submission.
- `public.submissions_overview`: a view joining both, for viewing in the dashboard.

SQL is in `supabase/migrations/`. To add a recipient, insert into `public.recipients` in the Supabase SQL editor:

```sql
insert into public.recipients(full_name) values ('First Last');
```

To let someone submit again, delete their submission row (and its image in Storage):

```sql
delete from public.submissions
where recipient_id = (select id from public.recipients where full_name = 'First Last');
```

## Deploy

Static site, no build step. Deployed on Vercel.
