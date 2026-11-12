/**
 * Universal links: with the iOS app installed, links to the site (above all
 * the emailed confirm and reset links) open in the app instead of Safari.
 *
 * iOS fetches /.well-known/apple-app-site-association from every host in the
 * app's Associated Domains entitlement (ios/App/App/App.entitlements) and
 * opens matching links in the app, which loads the path in its web view
 * (`appUrlOpen` in bootstrap.ts, limited to APP_HOSTS).
 *
 * The team ID is public (it is part of the served file), not a secret.
 */

export const APPLE_TEAM_ID = "54LWQR937V";
export const IOS_BUNDLE_ID = "app.findamine";
export const IOS_APP_ID = `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`;

interface AppLinkComponent {
  "/": string;
  exclude?: boolean;
  comment?: string;
}

export interface AppleAppSiteAssociation {
  applinks: { details: { appIDs: string[]; components: AppLinkComponent[] }[] };
}

/** Components are matched in order; the first match decides. */
export function appleAppSiteAssociation(): AppleAppSiteAssociation {
  return {
    applinks: {
      details: [
        {
          appIDs: [IOS_APP_ID],
          components: [
            { "/": "/api/auth/confirm", comment: "Emailed confirmation and password-reset links" },
            { "/": "/api/*", exclude: true, comment: "Other API routes stay in the browser" },
            { "/": "/*", comment: "Every page of the site" },
          ],
        },
      ],
    },
  };
}
