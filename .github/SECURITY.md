# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Email the maintainer directly or use GitHub's private vulnerability reporting
3. Include as much information as possible:
   - Type of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 7 days
  - Medium: 30 days
  - Low: 90 days

### Security Considerations

This project is a MITM proxy that intercepts HTTPS traffic. Please be aware:

1. **Certificate Trust**: The CA certificate should only be installed on devices you control
2. **Network Security**: Run the proxy only on trusted networks
3. **Data Privacy**: The proxy can see all traffic - don't use it on shared/public computers
4. **Certificate Storage**: Keep `.revamp-certs/` secure and don't commit to version control

## Security Best Practices

When using Revamp:

- Only install the CA certificate on your own devices
- Use strong network security (WPA3/WPA2)
- Don't expose proxy ports to the internet
- Regularly update dependencies
- Review blocked domains list for your needs

## Acknowledgments

We appreciate responsible disclosure and will acknowledge security researchers who help improve the project's security.
