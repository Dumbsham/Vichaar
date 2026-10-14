# Realtime Chat App

Build a simple chat application using raw websockets in node.js that supports the following features -

- Allow an admin to create a new chat session/room.Admin should be allowed to set the following properties on the room - 

1. Name
2. start_time
3. is_open
4. cool_down_time
5. Allow the user to send a message and join the room
6. Allow users to upvote the chat messages
7. if chat messages reach more than 3 upvotes, move them over to a separate section
8. if chat messages reach more than 10 upvotes, alert the admin to answer