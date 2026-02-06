import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';

export const appMetaTags = (title?: string) => {
  const description =
    'SIGN8 - Ihre Plattform für qualifizierte elektronische Signaturen (QES). Sichere, rechtskonforme digitale Unterschriften für Unternehmen. Einfache Integration, höchste Sicherheitsstandards.';

  return [
    {
      title: title ? `${title} - SIGN8` : 'SIGN8',
    },
    {
      name: 'description',
      content: description,
    },
    {
      name: 'keywords',
      content:
        'SIGN8, QES, qualifizierte elektronische Signatur, eIDAS, digitale Signatur, elektronische Unterschrift, Dokumentensignierung, rechtssichere Signatur',
    },
    {
      name: 'author',
      content: 'SIGN8',
    },
    {
      name: 'robots',
      content: 'index, follow',
    },
    {
      property: 'og:title',
      content: 'SIGN8 - Qualifizierte Elektronische Signaturen',
    },
    {
      property: 'og:description',
      content: description,
    },
    {
      property: 'og:image',
      content: `${NEXT_PUBLIC_WEBAPP_URL()}/opengraph-image.jpg`,
    },
    {
      property: 'og:type',
      content: 'website',
    },
    {
      name: 'twitter:card',
      content: 'summary_large_image',
    },
    {
      name: 'twitter:description',
      content: description,
    },
    {
      name: 'twitter:image',
      content: `${NEXT_PUBLIC_WEBAPP_URL()}/opengraph-image.jpg`,
    },
  ];
};
