-- Prediction streak columns — run once in the Supabase SQL editor.
--
-- Adds the current and best correct-pick streaks to the leaderboard aggregate so
-- the board can show a 🔥 badge next to hot predictors and the app can flash a
-- heater banner. Both are recomputed from game_predictions each time a user opens
-- My Stats (and nightly for the bots), same as the accuracy columns.

alter table prediction_stats add column if not exists current_streak int not null default 0;
alter table prediction_stats add column if not exists best_streak    int not null default 0;
