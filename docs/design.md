A simple blog + portfolio.

Each blog post has: title, summary, thumbnail, slug

Homepage: just show all the posts (titles, summaries, thumbnails)
clicking on the post takes to /blog/slug

portfolio cannot be navigated to on the website, can only be opened directly by /portfolio - this is not standard markdown

each post also has author: shows author image, twitter, linkedin, other links

each post is stored in markdown

blog has light and dark themes


note: the system has analytics that connect to a custom server
this includes sessions, page views, and different types of events
no cookies, all client side data would be in local storage
just the analytics part would be JS heavy

the ingest host is analytics.abhilakshsinghreen.com (VPS, separate from the
blog itself which is github pages). https only - the site is served over TLS,
so a plain-http ingest URL is blocked as mixed content

analytics only report from abhilakshsinghreen.com and www. anything else is
silent: localhost under dev, but also `astro preview` and `serve:pages`, which
serve production builds and would otherwise send real events. the check is on
window.location.hostname at runtime, not on import.meta.env.DEV at build time,
because DEV is false for those last two

to test against a local backend: PUBLIC_ANALYTICS_FORCE=true in .env.local.
the -dev appName in .env.development keeps that data in its own partition
