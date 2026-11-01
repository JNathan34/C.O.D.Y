using System.Numerics;
using System.Runtime.InteropServices;

namespace HeyClicky.Drawing3D;

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct Vertex3D(Vector3 position, Vector3 normal, Vector2 uv)
{
	public Vector3 Position = position;

	public Vector3 Normal = normal;

	public Vector2 UV = uv;

	public Vector4 Color = Vector4.One;

	public const int Stride = 48;
}
