#!/usr/bin/env bash
# Claude Code status line script

input=$(cat)

# Format a token count into a compact "k" string (e.g. 15500 -> 15.5k)
fmt_tokens() {
  awk -v n="$1" 'BEGIN {
    if (n >= 1000000) {
      v = n / 1000000
      if (v == int(v)) printf "%dM", v
      else printf "%.1fM", v
    } else if (n >= 1000) {
      v = n / 1000
      if (v < 100) printf "%.1fk", v
      else printf "%.0fk", v
    } else {
      printf "%d", n
    }
  }'
}

# --- Mode ---
vim_mode=$(echo "$input" | jq -r '.vim.mode // empty')
if [ -n "$vim_mode" ]; then mode_str="[$vim_mode]"; else mode_str=""; fi

# --- Directory ---
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
dir_str=$(basename "$cwd")

# --- Git branch ---
git_branch=$(GIT_DIR="$cwd/.git" git --git-dir="$cwd/.git" --work-tree="$cwd" symbolic-ref --short HEAD 2>/dev/null \
  || GIT_DIR="$cwd/.git" git --git-dir="$cwd/.git" --work-tree="$cwd" rev-parse --short HEAD 2>/dev/null)
if [ -n "$git_branch" ]; then branch_str="($git_branch)"; else branch_str=""; fi

# --- Model ---
model=$(echo "$input" | jq -r '.model.display_name // empty')

# --- Effort ---
effort=$(echo "$input" | jq -r '.effort.level // empty')
if [ -z "$effort" ]; then effort_str=""; else effort_str="effort:$effort"; fi

# --- Context usage ---
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
used_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // empty')
total_tokens=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
ctx_str=""
if [ -n "$used_pct" ]; then
  if [ -n "$used_tokens" ] && [ -n "$total_tokens" ]; then
    ctx_str=$(printf "ctx:%.0f%% (%s/%s)" "$used_pct" "$(fmt_tokens "$used_tokens")" "$(fmt_tokens "$total_tokens")")
  else
    ctx_str=$(printf "ctx:%.0f%%" "$used_pct")
  fi
fi

# --- Session (rate limit) usage ---
five_pct=$(echo "$input"   | jq -r '.rate_limits.five_hour.used_percentage // empty')
five_reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
week_pct=$(echo "$input"   | jq -r '.rate_limits.seven_day.used_percentage // empty')
week_reset=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

# Convert reset_at to Unix seconds (handles ms timestamps and ISO 8601 strings)
to_unix_sec() {
  local val="$1"
  if [[ "$val" =~ ^[0-9]+$ ]]; then
    [ "$val" -gt 9999999999 ] && echo $(( val / 1000 )) || echo "$val"
  else
    date -d "$val" +%s 2>/dev/null
  fi
}

# Format 5h reset: "HH:MM, HH:MM left"
fmt_5h_detail() {
  local ts; ts=$(to_unix_sec "$1")
  [ -z "$ts" ] && return
  local now; now=$(date +%s)
  local reset_time; reset_time=$(date -d "@$ts" "+%H:%M" 2>/dev/null)
  [ -z "$reset_time" ] && return
  local diff=$(( ts - now ))
  if [ "$diff" -le 0 ]; then
    printf "%s" "$reset_time"
  else
    local h=$(( diff / 3600 ))
    local m=$(( (diff % 3600) / 60 ))
    printf "%s, %02d:%02d left" "$reset_time" "$h" "$m"
  fi
}

# Format 7d reset: "Mon HH:MM"
fmt_7d_detail() {
  local ts; ts=$(to_unix_sec "$1")
  [ -z "$ts" ] && return
  date -d "@$ts" "+%a %H:%M" 2>/dev/null
}

session_str=""
if [ -n "$five_pct" ]; then
  five_str=$(printf "5h:%.0f%%" "$five_pct")
  if [ -n "$five_reset" ]; then
    five_detail=$(fmt_5h_detail "$five_reset")
    [ -n "$five_detail" ] && five_str="$five_str ($five_detail)"
  fi
  session_str="$five_str"
fi
if [ -n "$week_pct" ]; then
  week_str=$(printf "7d:%.0f%%" "$week_pct")
  if [ -n "$week_reset" ]; then
    week_detail=$(fmt_7d_detail "$week_reset")
    [ -n "$week_detail" ] && week_str="$week_str ($week_detail)"
  fi
  if [ -n "$session_str" ]; then session_str="$session_str $week_str"; else session_str="$week_str"; fi
fi

# --- Assemble ---
parts=()
[ -n "$mode_str"    ] && parts+=("$mode_str")
[ -n "$dir_str"     ] && parts+=("$dir_str")
[ -n "$branch_str"  ] && parts+=("$branch_str")
[ -n "$model"       ] && parts+=("$model")
[ -n "$effort_str"  ] && parts+=("$effort_str")
[ -n "$ctx_str"     ] && parts+=("$ctx_str")
[ -n "$session_str" ] && parts+=("$session_str")

status=""
for part in "${parts[@]}"; do
  if [ -z "$status" ]; then status="$part"; else status="$status | $part"; fi
done

printf "%s" "$status"
