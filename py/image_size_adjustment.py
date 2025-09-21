from .md import *
size_data = {}

class ImageSizeAdjustment:
    """Image preview and stretch adjustment node"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "adjust"
    CATEGORY = "🎈LAOGOU/Image"
    OUTPUT_NODE = True

    def adjust(self, image, unique_id):
        try:
            node_id = unique_id

            # Ensure old data is cleared if present
            if node_id in size_data:
                del size_data[node_id]

            event = Event()
            size_data[node_id] = {
                "event": event,
                "result": None
            }

            # Send preview image
            preview_image = (torch.clamp(image.clone(), 0, 1) * 255).cpu().numpy().astype(np.uint8)[0]
            pil_image = Image.fromarray(preview_image)
            buffer = io.BytesIO()
            pil_image.save(buffer, format="PNG")
            base64_image = base64.b64encode(buffer.getvalue()).decode('utf-8')

            try:
                PromptServer.instance.send_sync("image_preview_update", {
                    "node_id": node_id,
                    "image_data": f"data:image/png;base64,{base64_image}"
                })

                # Wait for frontend to finish adjustment
                if not event.wait(timeout=15):
                    if node_id in size_data:
                        del size_data[node_id]
                    return (image,)

                result_image = size_data[node_id]["result"]
                del size_data[node_id]
                return (result_image if result_image is not None else image,)

            except Exception as e:
                if node_id in size_data:
                    del size_data[node_id]
                return (image,)

        except Exception as e:
            if node_id in size_data:
                del size_data[node_id]
            return (image,)

@PromptServer.instance.routes.post("/image_preview/apply")
async def apply_image_preview(request):
    try:
        # Check content type
        content_type = request.headers.get('Content-Type', '')
        print(f"[ImagePreview] Request content type: {content_type}")

        if 'multipart/form-data' in content_type:
            # Handle multipart/form-data request
            reader = await request.multipart()

            # Read form fields
            node_id = None
            new_width = None
            new_height = None
            image_data = None

            # Process each form field
            while True:
                part = await reader.next()
                if part is None:
                    break

                if part.name == 'node_id':
                    node_id = await part.text()
                elif part.name == 'width':
                    new_width = int(await part.text())
                elif part.name == 'height':
                    new_height = int(await part.text())
                elif part.name == 'image_data':
                    # Read binary image data
                    image_data = await part.read(decode=False)
        else:
            # Handle JSON request
            data = await request.json()
            node_id = data.get("node_id")
            new_width = data.get("width")
            new_height = data.get("height")
            image_data = None

            # Check for base64-encoded image data
            adjusted_data_base64 = data.get("adjusted_data_base64")
            if adjusted_data_base64:
                if adjusted_data_base64.startswith('data:image'):
                    base64_data = adjusted_data_base64.split(',')[1]
                else:
                    base64_data = adjusted_data_base64
                image_data = base64.b64decode(base64_data)

        print(f"[ImagePreview] Received data - Node ID: {node_id}")
        print(f"[ImagePreview] Received dimensions: {new_width}x{new_height}")

        if node_id not in size_data:
            return web.json_response({"success": False, "error": "Node data does not exist"})

        try:
            node_info = size_data[node_id]

            if image_data:
                try:
                    # Create PIL image from binary data
                    buffer = io.BytesIO(image_data)
                    pil_image = Image.open(buffer)

                    # Convert to RGB mode (if it's RGBA)
                    if pil_image.mode == 'RGBA':
                        pil_image = pil_image.convert('RGB')

                    # Convert to numpy array
                    np_image = np.array(pil_image)

                    # Convert to PyTorch tensor - using correct shape [B, H, W, C]
                    tensor_image = torch.from_numpy(np_image / 255.0).float().unsqueeze(0)
                    print(f"[ImagePreview] Tensor shape created from binary data: {tensor_image.shape}")
                    node_info["result"] = tensor_image
                except Exception as e:
                    print(f"[ImagePreview] Error processing image data: {str(e)}")
                    traceback.print_exc()

            # Mark processed
            node_info["processed"] = True
            node_info["event"].set()
            return web.json_response({"success": True})

        except Exception as e:
            print(f"[ImagePreview] Error while processing data: {str(e)}")
            traceback.print_exc()
            if node_id in size_data and "event" in size_data[node_id]:
                size_data[node_id]["event"].set()
            return web.json_response({"success": False, "error": str(e)})

    except Exception as e:
        print(f"[ImagePreview] Request processing error: {str(e)}")
        traceback.print_exc()
        return web.json_response({"success": False, "error": str(e)})

NODE_CLASS_MAPPINGS = {
    "ImageSizeAdjustment": ImageSizeAdjustment,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageSizeAdjustment": "Image Size Adjustment",
}
