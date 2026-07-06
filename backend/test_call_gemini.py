import asyncio
from main import call_gemini

async def test():
    try:
        print("Testing text only:")
        res = await call_gemini("Say hello")
        print("Text response:", res)
    except Exception as e:
        print(f"Error text: {e}")

    try:
        print("\nTesting with photo:")
        # Generate a dummy small 1x1 image in bytes
        import base64
        photo_bytes = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")
        res = await call_gemini("What is this?", photo_bytes=photo_bytes, mime_type="image/png")
        print("Photo response:", res)
    except Exception as e:
        print(f"Error photo: {e}")

if __name__ == "__main__":
    asyncio.run(test())
