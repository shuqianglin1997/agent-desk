-- Hand-constructed minimal schema, generated in a temporary test directory via winsqlite3.
-- state_5.sqlite
CREATE TABLE threads(id TEXT PRIMARY KEY,title TEXT,updated_at INTEGER,cwd TEXT,rollout_path TEXT,source TEXT,archived INTEGER,agent_path TEXT);
INSERT INTO threads VALUES('12345678-1234-1234-1234-123456789abc','Database title',1791552004,'D:/demo','D:/demo/rollout.jsonl','desktop',0,NULL);
-- thread_history_1.sqlite (separate database)
CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,rollout_ordinal INTEGER);
CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_type TEXT,item_json TEXT,rollout_ordinal INTEGER);
INSERT INTO thread_turns VALUES('12345678-1234-1234-1234-123456789abc','turn-1','completed',1);
