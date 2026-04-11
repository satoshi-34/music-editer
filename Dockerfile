FROM node:20-slim

WORKDIR /app

# 依存だけ先にコピー（キャッシュ効かせる）
COPY package*.json ./

# 安全＆再現性のあるインストール
RUN npm ci --ignore-scripts

# 非rootユーザーに切り替え
USER node

# アプリ本体コピー
COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]