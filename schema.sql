-- 三视图学习站 · 匿名单用户库
-- SQLite（Node 24 内置 node:sqlite，无需编译原生模块）
-- 说明：uid 由服务端生成 UUID；data 为整站业务数据的 JSON 字符串。

CREATE TABLE IF NOT EXISTS Users (
  uid        TEXT    PRIMARY KEY,           -- 匿名用户标识（UUID v4）
  data       TEXT    NOT NULL DEFAULT '{}', -- 业务数据 JSON：错题、进度、备注等
  updated_at INTEGER NOT NULL               -- 最后访问时间（Unix 毫秒），用于 30 天滑动过期
);

-- 过期清理与按时间排序都依赖此索引
CREATE INDEX IF NOT EXISTS idx_users_updated_at ON Users (updated_at);
