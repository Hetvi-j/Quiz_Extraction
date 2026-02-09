import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random
import uuid

def generate_synthetic_dataset(output_dir, num_samples_per_sentence=5, font_path=None):
    """
    Generates a synthetic handwriting dataset with images and text files.

    Args:
        output_dir (str): The directory to save the generated dataset.
        num_samples_per_sentence (int): Number of augmented images to create for each sentence.
        font_path (str): Path to a TrueType font file (e.g., .ttf or .otf) to use for rendering.
                         If None, a default font will be used, but it's highly recommended
                         to use a handwriting-style font for better results.
    """
    # Create the output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)

    # Text corpus to generate images from
    text_corpus = [
        "The quick brown fox jumps over the lazy dog.",
        "Sphinx of black quartz, judge my vow.",
        "Pack my box with five dozen liquor jugs.",
        "How vexingly quick daft zebras jump!",
        "The early bird gets the worm.",
        "Practice makes perfect."
    ]

    # Use a handwriting font if provided, otherwise fall back to a default
    try:
        if font_path and os.path.exists(font_path):
            font = ImageFont.truetype(font_path, 40)
        else:
            # Fallback to a default font
            font = ImageFont.load_default()
            print("Warning: Handwriting-style font not found or not provided. Using a default font.")
    except Exception as e:
        print(f"Error loading font: {e}. Using a default font.")
        font = ImageFont.load_default()

    # Generate samples
    print(f"Generating synthetic dataset in '{output_dir}'...")
    for sentence in text_corpus:
        for i in range(num_samples_per_sentence):
            # Create a unique filename using UUID
            base_filename = str(uuid.uuid4())
            image_filename = f"{base_filename}.png"
            text_filename = f"{base_filename}.txt"

            # Create a blank white image
            img_width = 1024
            img_height = 128
            img = Image.new("RGB", (img_width, img_height), "white")
            draw = ImageDraw.Draw(img)

            # Add random offsets for position
            x_offset = random.randint(10, 50)
            y_offset = random.randint(20, 60)

            # Draw text on the image
            draw.text((x_offset, y_offset), sentence, font=font, fill="black")

            # Apply random transformations to simulate real-world handwriting
            # Random rotation
            angle = random.uniform(-1, 1)
            img = img.rotate(angle, expand=False, fillcolor="white")

            # Random noise (optional)
            if random.random() < 0.5:
                pixels = img.load()
                for y in range(img_height):
                    for x in range(img_width):
                        if random.random() < 0.001:  # small chance of noise
                            pixels[x, y] = (random.randint(0, 255),) * 3

            # Random blur (optional)
            if random.random() < 0.3:
                img = img.filter(ImageFilter.GaussianBlur(radius=0.5))

            # Save the image
            img_path = os.path.join(output_dir, image_filename)
            img.save(img_path)

            # Save the corresponding text file
            text_path = os.path.join(output_dir, text_filename)
            with open(text_path, "w", encoding="utf-8") as f:
                f.write(sentence)

    print(f"Dataset generation complete. Total samples created: {len(text_corpus) * num_samples_per_sentence}")
    print(f"The generated dataset is in the '{output_dir}' directory.")


if __name__ == "__main__":
    # --- Example Usage ---
    # 1. Define the output directory
    output_directory = "synthetic_handwriting_dataset"

    # 2. (Optional) Provide a path to a handwriting font.
    #    You can download free handwriting fonts from websites like Google Fonts.
    #    Example: 'Dancing Script', 'Indie Flower', etc.
    #    For this code to work with a custom font, you'll need to download a .ttf file
    #    and place it in the same directory as this script, then provide the path.
    #    Example: font_file = "IndieFlower-Regular.ttf"
    #    If you don't have a custom font, set it to None.
    font_file = None

    # 3. Call the generation function
    generate_synthetic_dataset(
        output_dir=output_directory,
        num_samples_per_sentence=10,
        font_path=font_file
    )