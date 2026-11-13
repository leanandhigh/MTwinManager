-- Where the account is in farming: '' (not farming), 'farming' or 'done'.
ALTER TABLE accounts ADD COLUMN farm TEXT NOT NULL DEFAULT '';
