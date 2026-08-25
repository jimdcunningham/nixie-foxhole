param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('prompt-encrypt', 'encrypt-stdin', 'decrypt-stdin')]
    [string]$Action,

    [string]$Prompt = 'Secret'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

function Protect-FoxWatchSecret {
    param([AllowEmptyString()][string]$Value)

    $plainBytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    try {
        $encryptedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
            $plainBytes,
            $null,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        return 'dpapi-v1:' + [Convert]::ToBase64String($encryptedBytes)
    } finally {
        if ($plainBytes.Length -gt 0) {
            [Array]::Clear($plainBytes, 0, $plainBytes.Length)
        }
    }
}

function Unprotect-FoxWatchSecret {
    param([Parameter(Mandatory = $true)][string]$Value)

    if ($Value.StartsWith('dpapi-v1:', [StringComparison]::Ordinal)) {
        $encryptedBytes = [Convert]::FromBase64String($Value.Substring('dpapi-v1:'.Length))
        $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $encryptedBytes,
            $null,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        try {
            return [System.Text.Encoding]::UTF8.GetString($plainBytes)
        } finally {
            if ($plainBytes.Length -gt 0) {
                [Array]::Clear($plainBytes, 0, $plainBytes.Length)
            }
        }
    }

    # Backward compatibility for values written by the original
    # ConvertFrom-SecureString implementation.
    $secure = ConvertTo-SecureString -String $Value
    $credential = [System.Net.NetworkCredential]::new('', $secure)
    return $credential.Password
}

switch ($Action) {
    'prompt-encrypt' {
        $secure = Read-Host -Prompt $Prompt -AsSecureString
        $credential = [System.Net.NetworkCredential]::new('', $secure)
        [Console]::Out.Write((Protect-FoxWatchSecret -Value $credential.Password))
    }
    'encrypt-stdin' {
        $plain = [Console]::In.ReadToEnd()
        [Console]::Out.Write((Protect-FoxWatchSecret -Value $plain))
    }
    'decrypt-stdin' {
        $encrypted = [Console]::In.ReadToEnd().Trim()
        [Console]::Out.Write((Unprotect-FoxWatchSecret -Value $encrypted))
    }
}
