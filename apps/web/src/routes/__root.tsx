import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { ConvexClientProvider } from "~/lib/ConvexClientProvider";
import appCss from "~/styles/globals.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Library of Things" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ConvexClientProvider>
          <Outlet />
        </ConvexClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
