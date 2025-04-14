// worker/src/index.ts

// Define the environment variables expected from wrangler.toml / secrets
export interface Env {
	EPIC_CLIENT_ID: string;
	EPIC_CLIENT_SECRET: string;
	REDIRECT_URI: string; // Worker's own /callback URL
	FRONTEND_URL: string; // URL of the React app
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Input validation
		if (!env.EPIC_CLIENT_ID || !env.EPIC_CLIENT_SECRET) {
			console.error("Missing EPIC_CLIENT_ID or EPIC_CLIENT_SECRET in environment variables.");
			return new Response("Server configuration error: Missing client credentials.", { status: 500 });
		}
		if (!env.REDIRECT_URI) {
			console.error("Missing REDIRECT_URI in environment variables.");
			return new Response("Server configuration error: Missing redirect URI.", { status: 500 });
		}
		if (!env.FRONTEND_URL) {
			console.error("Missing FRONTEND_URL in environment variables.");
			return new Response("Server configuration error: Missing frontend URL.", { status: 500 });
		}

		const CLIENT_ID = env.EPIC_CLIENT_ID;
		const CLIENT_SECRET = env.EPIC_CLIENT_SECRET;
		const REDIRECT_URI = env.REDIRECT_URI; // Use the one from env
		const FRONTEND_URL = env.FRONTEND_URL; // Use the one from env

		// Redirect to /login from root if needed, or show simple message
		if (url.pathname === "/") {
			return new Response(`Ready to authenticate with Epic Games. Go to <a href="/login">/login</a>`, {
				headers: { 'Content-Type': 'text/html' },
			});
		}

		// ===== LOGIN ROUTE =====
		if (url.pathname === "/login") {
			console.log(`Redirecting user to Epic Games authorization...`);
			// TODO: Consider adding a 'state' parameter for CSRF protection
			const authUrl = `https://www.epicgames.com/id/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(
				REDIRECT_URI
			)}`;
			return Response.redirect(authUrl, 302);
		}

		// ===== CALLBACK ROUTE =====
		if (url.pathname === "/callback") {
			const code = url.searchParams.get('code');
			if (!code) {
				console.error("Callback invoked without authorization code.");
				// Redirect back to frontend with error
				const errorRedirect = new URL(FRONTEND_URL);
				errorRedirect.searchParams.set("epic_login_error", "Missing authorization code");
				return Response.redirect(errorRedirect.toString(), 302);
			}

			console.log("Received authorization code, exchanging for token...");

			// --- Token Exchange --- 
			try {
				const tokenResp = await fetch('https://api.epicgames.dev/epic/oauth/v1/token', {
					method: 'POST',
					headers: {
						Authorization: `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
						'Content-Type': 'application/x-www-form-urlencoded',
					},
					body: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
				});

				if (!tokenResp.ok) {
					const errorText = await tokenResp.text();
					console.error(`Token exchange failed: ${tokenResp.status} ${errorText}`);
					// Redirect back to frontend with error
					const errorRedirect = new URL(FRONTEND_URL);
					errorRedirect.searchParams.set("epic_login_error", `Token exchange failed: ${tokenResp.status}`);
					return Response.redirect(errorRedirect.toString(), 302);
				}

				const tokenData = await tokenResp.json() as { access_token: string };
				const jwtToken = tokenData.access_token;
				console.log("JWT Token:", jwtToken);

				if (!jwtToken) {
					console.error("Token response missing id_token and access_token.");
					const errorRedirect = new URL(FRONTEND_URL);
					errorRedirect.searchParams.set("epic_login_error", "Missing token in response");
					return Response.redirect(errorRedirect.toString(), 302);
				}
				
				console.log("Received token (using id_token if available):", jwtToken);

				// --- JWT Validation (Optional but Recommended) --- 
				// You already have validation logic using JWKS. Keep it!
				// You might want to extract this validation logic into a separate function.

				const parts = jwtToken.split(".");
				if (parts.length !== 3) {
					console.error("Invalid JWT format: must have 3 parts");
					const errorRedirect = new URL(FRONTEND_URL);
					errorRedirect.searchParams.set("epic_login_error", "Invalid JWT format");
					return Response.redirect(errorRedirect.toString(), 302);
				}
				const [headerB64, payloadB64, signatureB64] = parts;

				// Helper function to safely decode base64url
				const safeBase64UrlDecode = (base64UrlStr: string): string => {
					try {
						let base64 = base64UrlStr.replace(/-/g, '+').replace(/_/g, '/');
						// Pad with '=' if needed
						while (base64.length % 4) {
							base64 += '=';
						}
						return atob(base64);
					} catch (error: unknown) {
						if (error instanceof Error) {
							console.error("Base64Url decoding error:", error.message, "Input:", base64UrlStr);
							throw new Error(`Invalid base64url data: ${error.message}`);
						}
						throw new Error('Invalid base64url data: unknown error');
					}
				};

				const headerJson = JSON.parse(safeBase64UrlDecode(headerB64)) as { alg: string; kid: string };
				const kid = headerJson.kid;

				// Fetch JWKS
				const jwksResp = await fetch("https://api.epicgames.dev/epic/oauth/v1/.well-known/jwks.json");
				if (!jwksResp.ok) {
					console.error(`Failed to fetch JWKS: ${jwksResp.status}`);
					const errorRedirect = new URL(FRONTEND_URL);
					errorRedirect.searchParams.set("epic_login_error", "Failed to fetch JWKS");
					return Response.redirect(errorRedirect.toString(), 302);
				}
				const jwks = await jwksResp.json();
				if (typeof jwks !== "object" || jwks === null || !Array.isArray((jwks as any).keys)) {
					console.error("Invalid JWKS format received.");
					const errorRedirect = new URL(FRONTEND_URL);
					errorRedirect.searchParams.set("epic_login_error", "Invalid JWKS format");
					return Response.redirect(errorRedirect.toString(), 302);
				}
				const jwk = (jwks as { keys: { kid: string }[] }).keys.find((key) => key.kid === kid);

				if (!jwk) {
					console.error(`Public key (kid: ${kid}) not found in JWKS.`);
					const errorRedirect = new URL(FRONTEND_URL);
					errorRedirect.searchParams.set("epic_login_error", "Public key not found");
					return Response.redirect(errorRedirect.toString(), 302);
				}

				// Import the JWK to a CryptoKey
				const cryptoKey = await crypto.subtle.importKey(
					"jwk",
					jwk, // Provide the JWK directly
					{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
					false, // Not extractable
					["verify"]
				);

				// Prepare data for verification
				const encoder = new TextEncoder();
				const dataToVerify = encoder.encode(`${headerB64}.${payloadB64}`);

				// Convert base64url signature to Uint8Array
				let signatureBase64 = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
				while (signatureBase64.length % 4) {
					signatureBase64 += '=';
				}
				const signatureBytes = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));

				// Verify the signature
				const isValid = await crypto.subtle.verify(
					"RSASSA-PKCS1-v1_5",
					cryptoKey,
					signatureBytes,
					dataToVerify
				);

				if (!isValid) {
					console.error("JWT signature verification failed.");
					const errorRedirect = new URL(FRONTEND_URL);
					errorRedirect.searchParams.set("epic_login_error", "JWT verification failed");
					return Response.redirect(errorRedirect.toString(), 302);
				}

				console.log("JWT signature verified successfully.");
				const payloadJson = JSON.parse(safeBase64UrlDecode(payloadB64));
				console.log("Decoded JWT Payload:", payloadJson);

				// --- Redirect back to Frontend --- 
				// Redirect back to the frontend app, passing the validated JWT in the hash
				const redirectUrl = new URL(FRONTEND_URL);
				// Use hash fragment to pass the token, avoids it being sent to server logs
				redirectUrl.hash = `epic_jwt=${jwtToken}`;

				console.log(`Redirecting back to frontend: ${redirectUrl.toString()}`);
				return Response.redirect(redirectUrl.toString(), 302);

			} catch (error: unknown) {
				console.error("Error during token exchange or JWT validation:", error);
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				// Redirect back to frontend with error
				const errorRedirect = new URL(FRONTEND_URL);
				errorRedirect.searchParams.set("epic_login_error", `Server error: ${errorMessage}`);
				return Response.redirect(errorRedirect.toString(), 302);
			}
		}

		// ===== NOT FOUND =====
		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>; 