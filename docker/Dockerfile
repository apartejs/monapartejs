# Sert le build statique (dist/bonaparte/browser, généré en CI ou en local
# via `pnpm build`) derrière nginx avec les en-têtes COOP/COEP requis.
#
#   pnpm build
#   docker build -f docker/Dockerfile -t bonaparte .
#   docker run --rm -p 8080:80 bonaparte
FROM nginx:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/bonaparte/browser /usr/share/nginx/html
EXPOSE 80
