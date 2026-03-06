# Usamos a imagem Debian-based (Bullseye) na versão 20 para instalar o Chromium nativamente
FROM node:20-bullseye-slim

# Evitamos prompts interativos durante a instalação
ENV DEBIAN_FRONTEND=noninteractive

# Instalamos as dependências do Chromium e o próprio Chromium open-source (nativo para ARM64 na Oracle)
RUN apt-get update && apt-get install -y \
    chromium \
    libxss1 \
    libnss3 \
    libasound2 \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configura o Puppeteer interno para usar o Chromium do sistema ARM64
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Define a pasta de trabalho do container
WORKDIR /app

# Copia apenas os arquivos de dependência primeiro (aproveita cache do Docker)
COPY package*.json ./

# Instala as dependências (pulará o puppeteer interno graças ao ENV acima)
RUN npm install

# Copia o restante dos arquivos (schema prisma, src, tsconfig, etc)
COPY . .

# Gera o client do Prisma para o Banco de Dados
RUN npx prisma generate

# Compila o TypeScript em Javascript (cria a pasta /dist)
RUN npm run build

# Copia e dá permissão de execução ao Entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expõe a porta 5000 do container
EXPOSE 5000

# Executa o script que limpa locks e sobe o Node
CMD ["/entrypoint.sh"]
