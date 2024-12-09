import { v4 as uuid } from "uuid";
import { sign as jwtSign } from "jsonwebtoken";
import { privateKey } from "./keys.ts";
import type { UserTokens } from "./types.ts";

type RawToken = Record<
	string,
	string | number | boolean | undefined | readonly string[]
>;

type User = {
	readonly Username: string;
	readonly Attributes?: readonly { Name: string; Value: string }[];
};

type ValidityUnit = "seconds" | "minutes" | "hours" | "days";

function formatExpiration({ duration, unit }: TokenValidity): string {
	return `${duration}${unit}`;
}

type TokenValidity = {
	readonly duration: number;
	readonly unit: ValidityUnit;
};

const defaultIdValidity = {
	duration: 24,
	unit: "hours",
} satisfies TokenValidity;

const defaultAccessValidity = {
	duration: 24,
	unit: "hours",
} satisfies TokenValidity;

const defaultRefreshValidity = {
	duration: 7,
	unit: "days",
} satisfies TokenValidity;

type Options = {
	readonly issuerDomain: string;
	readonly userPoolId: string;
	readonly userPoolClientId: string;
	readonly idTokenValidity?: TokenValidity;
	readonly accessTokenValidity?: TokenValidity;
	readonly refreshTokenValidity?: TokenValidity;
};

function generateCognitoUserTokens(
	{
		issuerDomain,
		userPoolId,
		userPoolClientId,
		idTokenValidity = defaultIdValidity,
		accessTokenValidity = defaultAccessValidity,
		refreshTokenValidity = defaultRefreshValidity,
	}: Options,
	user: User,
	userGroups: readonly string[],
): UserTokens {
	const eventId = uuid();
	const authTime = Math.floor(new Date().getTime() / 1000);
	const sub = user.Attributes?.find((a) => a.Name === "sub")?.Value;

	const accessToken: RawToken = {
		auth_time: authTime,
		client_id: userPoolClientId,
		event_id: eventId,
		iat: authTime,
		jti: uuid(),
		scope: "aws.cognito.signin.user.admin", // TODO: scopes
		sub,
		token_use: "access",
		username: user.Username,
	};
	const idToken: RawToken = {
		"cognito:username": user.Username,
		auth_time: authTime,
		email: user.Attributes?.find((a) => a.Name === "email")?.Value,
		email_verified: Boolean(
			user.Attributes?.find((a) => a.Name === "email_verified")?.Value ?? false,
		),
		event_id: eventId,
		iat: authTime,
		jti: uuid(),
		sub,
		token_use: "id",
		...Object.fromEntries(
			(user.Attributes?.filter((a) => a.Name.startsWith("custom:")) ?? []).map(
				(a) => [a.Name, a.Value],
			),
		),
	};

	if (userGroups.length) {
		accessToken["cognito:groups"] = userGroups;
		idToken["cognito:groups"] = userGroups;
	}

	const issuer = `${issuerDomain}/${userPoolId}`;

	return {
		AccessToken: jwtSign(accessToken, privateKey.pem, {
			algorithm: privateKey.jwk.alg,
			issuer,
			expiresIn: formatExpiration(accessTokenValidity),
			keyid: privateKey.jwk.kid,
		}),
		IdToken: jwtSign(idToken, privateKey.pem, {
			algorithm: privateKey.jwk.alg,
			issuer,
			expiresIn: formatExpiration(idTokenValidity),
			audience: userPoolClientId,
			keyid: privateKey.jwk.kid,
		}),
		// this content is for debugging purposes only
		// in reality token payload is encrypted and uses different algorithm
		RefreshToken: jwtSign(
			{
				"cognito:username": user.Username,
				email: user.Attributes?.find((a) => a.Name === "email")?.Value,
				iat: authTime,
				jti: uuid(),
			},
			privateKey.pem,
			{
				algorithm: "RS256",
				issuer,
				expiresIn: formatExpiration(refreshTokenValidity),
			},
		),
	};
}

export { generateCognitoUserTokens };