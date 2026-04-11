FROM node:20-slim

WORKDIR /app

# まずはパッケージ情報だけコピー
COPY package*.json ./

# コンテナの中で安全にインストールと修復を行う
RUN npm install && npm audit fix

# 全ファイルをコピー
COPY . .

# Viteなどの開発サーバー用ポートを開ける
EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]