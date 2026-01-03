import { Helmet } from 'react-helmet-async';

interface SEOHeadProps {
    title: string;
    description: string;
    canonicalPath?: string;
    keywords?: string[];
    type?: 'website' | 'article';
}

export function SEOHead({
    title,
    description,
    canonicalPath = '/',
    keywords = [],
    type = 'website'
}: SEOHeadProps) {
    const domain = 'https://app.smogw.pl';
    const url = `${domain}${canonicalPath}`;
    const image = `${domain}/og-image.png`;

    const keywordsString = keywords.length > 0
        ? keywords.join(', ')
        : 'smog, jakość powietrza, PM10, PM2.5, zanieczyszczenie powietrza, Polska, trendy';

    return (
        <Helmet>
            {/* Standard Metadata */}
            <title>{title}</title>
            <meta name="description" content={description} />
            <meta name="keywords" content={keywordsString} />
            <link rel="canonical" href={url} />

            {/* Open Graph / Facebook */}
            <meta property="og:type" content={type} />
            <meta property="og:url" content={url} />
            <meta property="og:title" content={title} />
            <meta property="og:description" content={description} />
            <meta property="og:image" content={image} />

            {/* Twitter */}
            <meta property="twitter:card" content="summary_large_image" />
            <meta property="twitter:url" content={url} />
            <meta property="twitter:title" content={title} />
            <meta property="twitter:description" content={description} />
            <meta property="twitter:image" content={image} />
        </Helmet>
    );
}
