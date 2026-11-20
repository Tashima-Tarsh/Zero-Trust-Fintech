package in.disha.upihost;

import static org.junit.Assert.assertEquals;
import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

public final class UpiResponseParserTest {
    @Test public void mapsSuccessfulResponseCode() {
        Map<String,String> values = new HashMap<>();
        values.put("responsecode", "00");
        assertEquals("SUCCESS", UpiResponseParser.status(values));
    }
    @Test public void mapsPendingResponse() {
        Map<String,String> values = new HashMap<>();
        values.put("status", "SUBMITTED");
        assertEquals("PENDING", UpiResponseParser.status(values));
    }
    @Test public void mapsFailureResponse() {
        Map<String,String> values = new HashMap<>();
        values.put("status", "FAILURE");
        assertEquals("FAILED", UpiResponseParser.status(values));
    }
    @Test public void neverAssumesSuccessWithoutResponseFields() {
        assertEquals("UNKNOWN", UpiResponseParser.status(new HashMap<>()));
    }
}
