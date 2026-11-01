using System;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace HeyClicky.Core.Auth;

public sealed class AuthTokenStore
{
	private static readonly byte[] Entropy = "HeyClicky.Auth.v1"u8.ToArray();

	private readonly string filePath;

	public string FilePath => filePath;

	public AuthTokenStore(string directory, bool isLocalBackend)
	{
		filePath = Path.Combine(directory, isLocalBackend ? "auth.localdev.bin" : "auth.bin");
	}

	public StoredAuthSession? Load()
	{
		try
		{
			if (!File.Exists(filePath))
			{
				return null;
			}
			return JsonSerializer.Deserialize(ProtectedData.Unprotect(File.ReadAllBytes(filePath), Entropy, DataProtectionScope.CurrentUser), CoreJsonContext.Default.StoredAuthSession);
		}
		catch (Exception ex)
		{
			Log.Warn("Auth", "stored session unreadable (" + ex.GetType().Name + "); starting signed out");
			return null;
		}
	}

	public bool Save(StoredAuthSession session)
	{
		try
		{
			byte[] array = ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(session, CoreJsonContext.Default.StoredAuthSession), Entropy, DataProtectionScope.CurrentUser);
			AtomicFile.WriteAllBytes(filePath, array);
			return true;
		}
		catch (Exception ex)
		{
			Log.Error("Auth", "session save failed", ex);
			return false;
		}
	}

	public bool Delete()
	{
		try
		{
			if (File.Exists(filePath))
			{
				File.Delete(filePath);
			}
			return true;
		}
		catch (Exception ex)
		{
			Log.Error("Auth", "session delete failed", ex);
			return false;
		}
	}
}
