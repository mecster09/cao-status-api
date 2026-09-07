# Separate status app and API behind NGINX

We will keep the read-only CAO adapter as `cao-status-api` and deploy the visual browser client as a separate `cao-status-app` service in the same stack. NGINX owns external routing, while the app uses a relative API base path to reach the API. This keeps the API reusable for Homepage.dev and other clients, keeps browser presentation concerns out of the adapter, and avoids exposing CAO directly.

## Consequences

- The stack builds and deploys two images from one repository.
- The API remains read-only and contains no UI dependencies.
- The app can evolve its visualization independently of the API contract.
