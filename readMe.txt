ReadMe for Scripts:

Basically how it works is you can take the blueprint image, import it into this tool, and draw the boundaries of corridors and rooms,
the points for doors, and the lines for barrier walls. Then you can download the map data as a JSON file. There are some other cool
tools also used in it too. Made with Claude Sonnet 4.6

TO MAKE CHANGES TO THE MAIN MAP DATA SET:
    1. Go into scripts.js
    2. Change Line 2: const IMAGE_SRC = "Main_Annotated_Simple.png"
    3. Open index.html (click on the file, it should open in Chrome/Edge)
    4. Either create all new changes manually OR hit "Import JSON" button
    5. Make all changes and hit "Export JSON" when finished (these do not save if you exit the webpage)

TO MAKE CHANGES TO THE SQUASH MAP DATA SET:
    1. Go into scripts.js
    2. Change Line 2: const IMAGE_SRC = "Squash_Annotated_Simple.png"
    3. Do all the steps as listed above to make changes

MAKING CHANGES:

    1. For Rooms and Corridors: These are polygons, so you need to use the polyline tool to draw a shape then click "Close Shape"
    2. For Barriers: These are lines. Just click two points and it will make a barrier.
    3. For Doors: These are single points, just click anywhere.

