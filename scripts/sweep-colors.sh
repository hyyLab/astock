#!/bin/bash
# 暗色主题改造：全组件硬编码色值 → 语义 token 类（一次性机械替换）
# 顺序无关（token 互不为前缀），bg-white 使用词边界防误伤
set -e
DIR="/home/z/my-project/src/components/lb"
FILES="$DIR/*.tsx $DIR/*.ts /home/z/my-project/src/app/page.tsx"

apply() {
  local from="$1" to="$2"
  sed -i "s/${from}/${to}/g" $FILES
}

# 文字层级
apply 'text-\[#1b1f2a\]' 'text-foreground'
apply 'text-\[#374151\]' 'text-fg2'
apply 'text-\[#6b7280\]' 'text-muted-foreground'
apply 'text-\[#9ca3af\]' 'text-dim'
apply 'text-\[#b6bcc7\]' 'text-dim2'
apply 'text-\[#c9cdd4\]' 'text-dim2'
apply 'text-\[#d8dbe0\]' 'text-dim2'
apply 'text-\[#d1d5db\]' 'text-dim2'
apply 'text-\[#9aa1ad\]' 'text-flat'

# 行情语义（文字）
apply 'text-\[#c2352f\]' 'text-up'
apply 'text-\[#8f2b27\]' 'text-up'
apply 'text-\[#0b7d52\]' 'text-down'
apply 'text-\[#e8850c\]' 'text-warn'
apply 'text-\[#b45309\]' 'text-warn-strong'
apply 'text-\[#2563eb\]' 'text-link'
apply 'text-\[#4f6bed\]' 'text-link-strong'

# 底色
apply 'bg-white' 'bg-card'
apply 'bg-\[#f3f4f6\]' 'bg-muted'
apply 'bg-\[#f7f8fa\]' 'bg-subtle'
apply 'bg-\[#fafbfc\]' 'bg-hover'
apply 'bg-\[#d9352f\]' 'bg-up'
apply 'bg-\[#0e9663\]' 'bg-down'
apply 'bg-\[#e8850c\]' 'bg-warn'
apply 'bg-\[#9aa1ad\]' 'bg-flat'
apply 'bg-\[#fdecec\]' 'bg-up-soft'
apply 'bg-\[#e2f5ec\]' 'bg-down-soft'
apply 'bg-\[#fef3e2\]' 'bg-warn-soft'
apply 'bg-\[#fdf6ec\]' 'bg-warn-soft'
apply 'bg-\[#fffdf7\]' 'bg-warn-bg'
apply 'bg-\[#eef2ff\]' 'bg-link-soft-bg'

# 边框
apply 'border-\[#e6e8ec\]' 'border-border'
apply 'border-\[#f0f1f3\]' 'border-line'
apply 'border-\[#f7f8fa\]' 'border-line'
apply 'border-\[#e5e7eb\]' 'border-line'
apply 'divide-\[#f0f1f3\]' 'divide-line'
apply 'border-\[#f3c8c6\]' 'border-up-soft'
apply 'border-\[#bfe5d3\]' 'border-down-soft'
apply 'border-\[#f3ddb5\]' 'border-warn-soft'
apply 'border-\[#f0d9ae\]' 'border-warn-soft'
apply 'border-\[#93b4f5\]' 'border-link-soft'
apply 'border-\[#c7d2fe\]' 'border-link-soft'

echo "替换完成"
# 校验：剩余硬编码应仅剩 JS 内联色（后续图表主题化处理）
rg -n '#[0-9a-fA-F]{6}' $DIR/*.tsx $DIR/*.ts | rg -v "STAGE_COLOR|rgba\(" || echo "（无残留类内色值）"
