# Security Rules

Review:
- RLS
- Authentication
- Authorization
- Secrets
- Input validation
- XSS/injection
- IDOR/broken access control
- Logs and sensitive data
- Dependencies
- File upload handling

## Policy (from scaffold SECURITY.md)

- Enforce authorization server-side and/or through Supabase RLS.
- Never expose privileged secrets to browser/client code.
- Validate inputs and protect against broken access control, IDOR, injection, XSS, unsafe file handling, and sensitive-data leakage.
- Review dependency/security scan results before release.
- High-impact security findings block release unless explicitly accepted by the owner.
