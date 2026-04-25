FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
COPY index.html ./
EXPOSE 3000
CMD ["node", "server.js"]
