FROM node:20-alpine AS builder
WORKDIR /app

# Build args for NEXT_PUBLIC_* env vars (injected at build time)
ARG NEXT_PUBLIC_API_URL=https://akarouter-production.up.railway.app
ARG NEXT_PUBLIC_SUPABASE_URL=https://fleouqrgltkodumrgxlt.supabase.co
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsZW91cXJnbHRrb2R1bXJneGx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzQ4MTMsImV4cCI6MjA5NjMxMDgxM30.KTL_9jMVbygM8A7bepgdAv37pZZctZ4F-cGAUBm4Jgw
ARG NEXT_PUBLIC_ADMIN_KEY

# Set as env vars for the build
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_ADMIN_KEY=$NEXT_PUBLIC_ADMIN_KEY

COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
